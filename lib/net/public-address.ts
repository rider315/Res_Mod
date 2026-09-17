import { isIP } from 'node:net'

/**
 * Whether an IP address is somewhere on the public internet.
 *
 * Every outbound request the server makes on a user's say-so — the mailbox it
 * signs in to, the job post it reads — is checked against this first, so a
 * hostname a user controls can't be pointed at a private network, at localhost,
 * or at a cloud metadata service. Server-only.
 */

function ipv4Parts(ip: string): number[] {
  return ip.split('.').map(Number)
}

/** Not private, loopback, link-local, reserved or multicast. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) {
    const [a, b, c] = ipv4Parts(ip)
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
    if (a === 198 && (b === 18 || b === 19)) return false
    if (a === 198 && b === 51 && c === 100) return false
    if (a === 203 && b === 0 && c === 113) return false
    return true
  }
  if (family === 6) {
    const lower = ip.toLowerCase()
    const mapped = /^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower) ?? /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
    if (mapped) return isPublicAddress(mapped[1])
    if (lower === '::' || lower === '::1') return false
    // Prefixes that carry an IPv4 address inside (NAT64, 6to4, Teredo) could hide a private one.
    if (lower.startsWith('64:ff9b:') || lower.startsWith('2002:') || /^2001:0*:/.test(lower)) return false
    const first = parseInt(lower.split(':')[0] || '0', 16)
    if ((first & 0xfe00) === 0xfc00) return false // unique local fc00::/7
    if ((first & 0xffc0) === 0xfe80) return false // link-local fe80::/10
    if ((first & 0xff00) === 0xff00) return false // multicast
    if (lower.startsWith('2001:db8:') || lower.startsWith('2001:0db8:')) return false // documentation
    if (lower.startsWith('::')) return false // other embedded or reserved forms
    return true
  }
  return false
}
