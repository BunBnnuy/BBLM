// BBLM_Importer.cs
//
// Companion script for BB's LibMan. Install once by importing
// BBLM_Importer.unitypackage into your project (or by dropping this file
// anywhere under an "Editor" folder, e.g. Assets/Editor/).
//
// While the Editor is open, this does two things:
//
//   1. Announces this project to BB's LibMan by writing a small heartbeat
//      file to a shared "registry" folder in %APPDATA%/BBLM/unity-projects/.
//      BB's LibMan reads that folder to discover which Unity projects are
//      currently open, so you never have to point it at a project by hand —
//      just have the project open with this script installed.
//
//   2. Watches "<ProjectRoot>/BBLM_Import/" (a folder *outside* Assets, so
//      Unity's own asset database ignores it) for .unitypackage files
//      dropped there by BB's LibMan, and imports them automatically via
//      AssetDatabase.ImportPackage.
//
// Unity's command line has no way to inject a package import into an
// already-running Editor instance, so this poll-a-folder approach is the
// bridge in both directions.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using UnityEditor;
using UnityEngine;
using Process = System.Diagnostics.Process;

[InitializeOnLoad]
public static class BBLM_Importer
{
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    static extern bool AttachThreadInput(uint currentThreadId, uint targetThreadId, bool attach);

    [DllImport("user32.dll")]
    static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool ShowWindowAsync(IntPtr hWnd, int command);

    const int ShowNormal = 1;
    static readonly string ProjectRoot = Directory.GetParent(Application.dataPath).FullName;
    static readonly string ProjectName = new DirectoryInfo(ProjectRoot).Name;

    static readonly string WatchFolder = Path.Combine(ProjectRoot, "BBLM_Import");
    static readonly string ImportedFolder = Path.Combine(WatchFolder, "Imported");

    static readonly string RegistryDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BBLM", "unity-projects");
    static readonly string RegistryFile = Path.Combine(RegistryDir, ProjectIdHash() + ".json");

    static double lastImportPollTime;
    const double ImportPollIntervalSeconds = 1.5;
    const int HeartbeatIntervalMs = 5000;
    static readonly Queue<string> PendingImports = new Queue<string>();
    static string ActiveImport;
    static double nextImportNotBefore;

    // EditorApplication.update is throttled hard (sometimes to a near-standstill)
    // while the Editor window isn't focused, which made the old update-driven
    // heartbeat go stale for long stretches even though the project was still
    // open. A real background Timer keeps ticking regardless of Editor focus.
    static Timer heartbeatTimer;

    static BBLM_Importer()
    {
        EditorApplication.update += PollImports;
        AssetDatabase.importPackageCompleted += OnImportPackageCompleted;
        AssetDatabase.importPackageCancelled += OnImportPackageCancelled;
        AssetDatabase.importPackageFailed += OnImportPackageFailed;

        heartbeatTimer = new Timer(_ => WriteHeartbeat(), null, 0, HeartbeatIntervalMs);
        AssemblyReloadEvents.beforeAssemblyReload += () => heartbeatTimer?.Dispose();
        EditorApplication.quitting += () =>
        {
            heartbeatTimer?.Dispose();
            try { File.Delete(RegistryFile); } catch { }
        };
    }

    static string ProjectIdHash()
    {
        using (var md5 = MD5.Create())
        {
            var bytes = md5.ComputeHash(Encoding.UTF8.GetBytes(ProjectRoot.ToLowerInvariant()));
            var sb = new StringBuilder();
            foreach (var b in bytes) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
    }

    static void WriteHeartbeat()
    {
        try
        {
            Directory.CreateDirectory(RegistryDir);
            var json =
                "{\n" +
                $"  \"projectPath\": {JsonString(ProjectRoot)},\n" +
                $"  \"projectName\": {JsonString(ProjectName)},\n" +
                $"  \"pid\": {System.Diagnostics.Process.GetCurrentProcess().Id},\n" +
                $"  \"lastSeen\": {JsonString(DateTime.UtcNow.ToString("o"))}\n" +
                "}\n";

            // Atomic-ish write so BB's LibMan never reads a half-written file.
            // Encoding.UTF8 (the static instance) writes a byte-order-mark, which
            // breaks JSON.parse on the reading side — use a BOM-less encoding.
            var tempFile = RegistryFile + ".tmp";
            File.WriteAllText(tempFile, json, new UTF8Encoding(false));
            File.Copy(tempFile, RegistryFile, true);
            File.Delete(tempFile);
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[BBLM] Failed to write registry heartbeat: {e.Message}");
        }
    }

    static string JsonString(string s)
    {
        return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    static void PollImports()
    {
        var now = EditorApplication.timeSinceStartup;
        if (now - lastImportPollTime < ImportPollIntervalSeconds) return;
        lastImportPollTime = now;

        if (!Directory.Exists(WatchFolder)) return;

        if (ActiveImport == null && PendingImports.Count == 0)
        {
            var file = Directory.GetFiles(WatchFolder, "*.unitypackage").FirstOrDefault();
            if (file != null) PendingImports.Enqueue(Path.GetFullPath(file));
        }
        StartNextImport();
    }

    static void ImportOne(string file)
    {
        try
        {
            Directory.CreateDirectory(ImportedFolder);

            // Move first so a crash/duplicate poll tick can't re-import the same
            // file twice, then import from the archived copy.
            var archived = Path.Combine(ImportedFolder,
                DateTime.Now.ToString("yyyyMMdd_HHmmss_") + Path.GetFileName(file));
            File.Move(file, archived);

            PendingImports.Enqueue(Path.GetFullPath(archived));
        }
        catch (IOException)
        {
            // File is still being written by BB's LibMan — just retry on the next poll.
        }
        catch (Exception e)
        {
            Debug.LogError($"[BBLM] Failed to import {file}: {e.Message}");
        }
    }

    static void StartNextImport()
    {
        if (ActiveImport != null || PendingImports.Count == 0) return;
        if (EditorApplication.timeSinceStartup < nextImportNotBefore)
        {
            EditorApplication.delayCall += StartNextImport;
            return;
        }
        ActiveImport = PendingImports.Dequeue();
        var packageToImport = ActiveImport;
        FocusUnityWindow();
        Debug.Log($"[BBLM] Queued Unity Package Import dialog for {Path.GetFileName(packageToImport)} ({PendingImports.Count} remaining)…");

        // Wait until the current update and file-system refresh are complete.
        EditorApplication.delayCall += () => EditorApplication.delayCall += () =>
        {
            try
            {
                FocusUnityWindow();
                AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
                AssetDatabase.ImportPackage(packageToImport, true);
            }
            catch (Exception e)
            {
                Debug.LogError($"[BBLM] Failed to open Unity Package Import dialog: {e.Message}");
                FinishImport(packageToImport);
            }
        };
    }

    static void FocusUnityWindow()
    {
        try
        {
            var window = Process.GetCurrentProcess().MainWindowHandle;
            if (window == IntPtr.Zero) return;
            var foreground = GetForegroundWindow();
            var foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out _);
            var currentThread = GetCurrentThreadId();
            var attached = foregroundThread != 0 && foregroundThread != currentThread && AttachThreadInput(currentThread, foregroundThread, true);
            ShowWindowAsync(window, ShowNormal);
            BringWindowToTop(window);
            SetForegroundWindow(window);
            if (attached) AttachThreadInput(currentThread, foregroundThread, false);
            Debug.Log($"[BBLM] Focused Unity window (handle={window}, foregroundThread={foregroundThread}, attached={attached}).");
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[BBLM] Could not focus the Unity Editor window: {e.Message}");
        }
    }

    static bool IsActiveImport(string packageName)
    {
        if (ActiveImport == null) return false;
        var activeName = Path.GetFileName(ActiveImport);
        return string.Equals(activeName, packageName, StringComparison.OrdinalIgnoreCase) ||
            (!string.IsNullOrEmpty(packageName) && packageName.EndsWith(activeName, StringComparison.OrdinalIgnoreCase));
    }

    static void FinishImport(string packageName)
    {
        if (ActiveImport == null) return;
        var completedFile = ActiveImport;
        try
        {
            Directory.CreateDirectory(ImportedFolder);
            var archived = Path.Combine(ImportedFolder,
                DateTime.Now.ToString("yyyyMMdd_HHmmss_") + Path.GetFileName(completedFile));
            if (File.Exists(completedFile)) File.Move(completedFile, archived);
        }
        catch (Exception e) { Debug.LogWarning($"[BBLM] Could not archive imported package: {e.Message}"); }
        Debug.Log($"[BBLM] Unity package operation finished: {Path.GetFileName(completedFile)}");
        ActiveImport = null;
        nextImportNotBefore = EditorApplication.timeSinceStartup + 1.5;
        EditorApplication.delayCall += StartNextImport;
    }

    static void OnImportPackageCompleted(string packageName) => FinishImport(packageName);
    static void OnImportPackageCancelled(string packageName) => FinishImport(packageName);
    static void OnImportPackageFailed(string packageName, string errorMessage)
    {
        Debug.LogError($"[BBLM] Unity package import failed: {packageName}: {errorMessage}");
        FinishImport(packageName);
    }
}
