const dns = require('dns').promises;
const net = require('net');

function ipv4ToNumber(ip) { return ip.split('.').reduce((n, x) => (n * 256) + Number(x), 0); }
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const n = ipv4ToNumber(ip); const a = n >>> 24; const b = (n >>> 16) & 255;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 100 && b >= 64 && b <= 127 || a >= 224 || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0);
  }
  const x = ip.toLowerCase();
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.') || x.startsWith('::ffff:127.');
}
async function validateUrl(target, { allowHttp = false } = {}) {
  let u; try { u = new URL(target); } catch { throw new Error('Invalid URL'); }
  if ((allowHttp ? !['http:', 'https:'] : u.protocol !== 'https:')) throw new Error('Only HTTPS URLs are allowed');
  if (u.username || u.password || /[\x00-\x1f\x7f]/.test(target) || target.length > 8192) throw new Error('Unsafe URL');
  const addresses = await dns.lookup(u.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(a => isPrivateAddress(a.address))) throw new Error('URL resolves to a private address');
  return { url: u, addresses: addresses.map(a => a.address) };
}
module.exports = { isPrivateAddress, validateUrl };
