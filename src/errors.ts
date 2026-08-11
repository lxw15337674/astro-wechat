/**
 * The five error categories from technical design section 9.
 *
 * Category matters operationally: it decides whether a failure is the author's
 * to fix, the operator's, or safe to retry. Quota is separated from the general
 * WeChat category precisely because retrying it reliably makes things worse.
 */
export type ErrorCategory =
  | 'source-validation'
  | 'asset'
  | 'render'
  | 'wechat'
  | 'quota'
  // Failures of the forwarding proxy itself: unreachable, bad token, path not
  // allowlisted. Separated from `wechat` because the fix is operational rather
  // than editorial, and because the proxy failing says nothing about whether
  // the account is healthy.
  | 'proxy'

export interface AstroWechatErrorOptions {
  /** Machine-readable discriminator within the category. */
  readonly code: string
  /** Source file the failure is attributed to, when there is one. */
  readonly sourcePath?: string
  readonly cause?: unknown
}

export class AstroWechatError extends Error {
  readonly category: ErrorCategory
  readonly code: string
  readonly sourcePath: string | undefined

  constructor(category: ErrorCategory, message: string, options: AstroWechatErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = new.target.name
    this.category = category
    this.code = options.code
    this.sourcePath = options.sourcePath
  }

  /**
   * Whether retrying the failed operation could plausibly succeed.
   *
   * Only transport-level WeChat failures qualify, and the client narrows
   * further by error code. Everything else needs a human.
   */
  get retryable(): boolean {
    return false
  }
}

export class SourceValidationError extends AstroWechatError {
  constructor(message: string, options: AstroWechatErrorOptions) {
    super('source-validation', message, options)
  }
}

export class AssetError extends AstroWechatError {
  constructor(message: string, options: AstroWechatErrorOptions) {
    super('asset', message, options)
  }
}

export class RenderError extends AstroWechatError {
  constructor(message: string, options: AstroWechatErrorOptions) {
    super('render', message, options)
  }
}

/** A diagnostic that does not stop processing. */
export interface Warning {
  readonly code: string
  readonly message: string
  readonly sourcePath?: string
}

/**
 * Collects warnings so a command can report every problem at once.
 *
 * Reporting one warning per run would make a post with five ambiguous asset
 * paths take five runs to clean up.
 */
export class WarningCollector {
  readonly #warnings: Warning[] = []

  add(warning: Warning): void {
    this.#warnings.push(warning)
  }

  get warnings(): readonly Warning[] {
    return this.#warnings
  }

  get isEmpty(): boolean {
    return this.#warnings.length === 0
  }
}
