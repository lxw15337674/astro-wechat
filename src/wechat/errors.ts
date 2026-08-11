import { AstroWechatError, type AstroWechatErrorOptions } from '../errors.js'

export interface WechatErrorOptions extends AstroWechatErrorOptions {
  /** WeChat `errcode`, absent for transport-level failures. */
  readonly errcode?: number
  readonly httpStatus?: number
  readonly retryable?: boolean
}

/** A failure attributable to WeChat: transport, authentication, or business. */
export class WechatApiError extends AstroWechatError {
  readonly errcode: number | undefined
  readonly httpStatus: number | undefined
  readonly #retryable: boolean

  constructor(message: string, options: WechatErrorOptions) {
    super('wechat', message, options)
    this.errcode = options.errcode
    this.httpStatus = options.httpStatus
    this.#retryable = options.retryable ?? false
  }

  override get retryable(): boolean {
    return this.#retryable
  }
}

/**
 * Daily interface quota or permanent-material quota is exhausted.
 *
 * Its own class rather than a flag so that no generic "retry WeChat errors"
 * path can ever pick it up by accident.
 */
export class WechatQuotaError extends AstroWechatError {
  readonly errcode: number | undefined

  constructor(message: string, options: WechatErrorOptions) {
    super('quota', message, options)
    this.errcode = options.errcode
  }

  override get retryable(): boolean {
    return false
  }
}

/** The forwarding proxy failed, before WeChat was ever reached. */
export class ProxyError extends AstroWechatError {
  readonly httpStatus: number | undefined
  readonly #retryable: boolean

  constructor(message: string, options: WechatErrorOptions) {
    super('proxy', message, options)
    this.httpStatus = options.httpStatus
    this.#retryable = options.retryable ?? false
  }

  override get retryable(): boolean {
    return this.#retryable
  }
}

/**
 * A write timed out with the server's outcome unknown.
 *
 * The single most dangerous state in this system: the draft may or may not
 * exist. Retrying is how duplicate drafts get created, so this must propagate
 * to the synchronizer, which reconciles against WeChat before acting
 * (ADR-0002).
 */
export class OutcomeUnknownError extends AstroWechatError {
  constructor(message: string, options: AstroWechatErrorOptions) {
    super('wechat', message, options)
  }

  override get retryable(): boolean {
    return false
  }
}
