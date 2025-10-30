type ReleaseFn = () => void

class Semaphore {
  private readonly limit: number
  private active = 0
  private queue: Array<() => void> = []

  constructor(limit: number) {
    this.limit = limit
  }

  private get isUnlimited() {
    return !Number.isFinite(this.limit) || this.limit <= 0
  }

  async acquire(): Promise<ReleaseFn> {
    if (this.isUnlimited) {
      return () => { /* no-op */ }
    }

    return new Promise<ReleaseFn>((resolve) => {
      const tryAcquire = () => {
        if (this.active < this.limit) {
          this.active += 1
          resolve(() => this.release())
        } else {
          this.queue.push(tryAcquire)
        }
      }

      tryAcquire()
    })
  }

  private release() {
    if (this.isUnlimited) {
      return
    }

    this.active = Math.max(0, this.active - 1)
    const next = this.queue.shift()
    if (next) {
      next()
    }
  }

  isIdle() {
    return this.active === 0 && this.queue.length === 0
  }

  getMetrics() {
    return {
      active: this.isUnlimited ? 0 : this.active,
      waiting: this.isUnlimited ? 0 : this.queue.length,
      limit: this.isUnlimited ? Number.POSITIVE_INFINITY : this.limit,
    }
  }
}

interface LimiterConfig {
  label: string
  globalLimit: number
  perUserLimit: number
}

interface LimiterMetrics {
  label: string
  global: {
    active: number
    waiting: number
    limit: number
  }
  perUser: {
    totalUsers: number
    active: number
    waiting: number
    limit: number
  }
}

type LimiterRunFn = <T>(userId: string, task: () => Promise<T>) => Promise<T>

interface ScopedLimiter {
  label: string
  run: LimiterRunFn
  getMetrics: () => LimiterMetrics
}

const parseLimit = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Number.POSITIVE_INFINITY
  }

  return parsed
}

const toLimitNumber = (limit: number) =>
  Number.isFinite(limit) ? limit : Number.POSITIVE_INFINITY

const createScopedLimiter = ({ label, globalLimit, perUserLimit }: LimiterConfig): ScopedLimiter => {
  const globalSemaphore = new Semaphore(globalLimit)
  const perUserSemaphores = new Map<string, Semaphore>()

  const getUserSemaphore = (userId: string) => {
    if (!Number.isFinite(perUserLimit) || perUserLimit <= 0) {
      return null
    }

    let semaphore = perUserSemaphores.get(userId)
    if (!semaphore) {
      semaphore = new Semaphore(perUserLimit)
      perUserSemaphores.set(userId, semaphore)
    }
    return semaphore
  }

  const run: LimiterRunFn = async (userId, task) => {
    const releases: ReleaseFn[] = []
    let userSemaphore: Semaphore | null = null

    try {
      releases.push(await globalSemaphore.acquire())
      userSemaphore = getUserSemaphore(userId)
      if (userSemaphore) {
        releases.push(await userSemaphore.acquire())
      }

      return await task()
    } finally {
      releases.reverse().forEach((release) => release())
      if (userSemaphore && userSemaphore.isIdle()) {
        perUserSemaphores.delete(userId)
      }
    }
  }

  const getMetrics = (): LimiterMetrics => {
    const globalMetrics = globalSemaphore.getMetrics()
    let perUserActive = 0
    let perUserWaiting = 0

    for (const semaphore of perUserSemaphores.values()) {
      const metrics = semaphore.getMetrics()
      perUserActive += metrics.active
      perUserWaiting += metrics.waiting
    }

    return {
      label,
      global: {
        active: globalMetrics.active,
        waiting: globalMetrics.waiting,
        limit: toLimitNumber(globalLimit),
      },
      perUser: {
        totalUsers: perUserSemaphores.size,
        active: perUserActive,
        waiting: perUserWaiting,
        limit: toLimitNumber(perUserLimit),
      },
    }
  }

  return {
    label,
    run,
    getMetrics,
  }
}

const uploadLimiter = createScopedLimiter({
  label: 'upload',
  // Premium plans: increase UPLOAD_* limits once Supabase bandwidth allows more concurrent uploads.
  globalLimit: parseLimit(process.env['UPLOAD_GLOBAL_LIMIT'], Number.POSITIVE_INFINITY),
  perUserLimit: parseLimit(process.env['UPLOAD_PER_USER_LIMIT'], Number.POSITIVE_INFINITY),
})

const deleteLimiter = createScopedLimiter({
  label: 'delete',
  globalLimit: parseLimit(process.env['DELETE_GLOBAL_LIMIT'], Number.POSITIVE_INFINITY),
  perUserLimit: parseLimit(process.env['DELETE_PER_USER_LIMIT'], Number.POSITIVE_INFINITY),
})

export const throttling = {
  upload: uploadLimiter,
  delete: deleteLimiter,
  getMetrics: () => ({
    upload: uploadLimiter.getMetrics(),
    delete: deleteLimiter.getMetrics(),
  }),
}
