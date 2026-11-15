// SSRF guard: only allow tumblr.com and api.tumblr.com hosts
export function isAllowedTumblrHost(host: string): boolean {
  const normalized = host.toLowerCase()
  return normalized === 'tumblr.com' || 
         normalized === 'www.tumblr.com' || 
         normalized === 'api.tumblr.com' ||
         normalized.endsWith('.tumblr.com')
}
