// Minimal runtime stand-in for the Cloudflare base class under Vitest.
// Production builds resolve `cloudflare:workers` to Cloudflare's implementation.
export class DurableObject<Env = unknown> {
  protected ctx: DurableObjectState
  protected env: Env

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env
  }
}
