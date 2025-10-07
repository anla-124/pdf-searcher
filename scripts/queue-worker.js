#!/usr/bin/env node

/**
 * Production Queue Worker - Self-contained JavaScript implementation
 * This version avoids TypeScript import issues by using direct requires
 */

require('dotenv').config()

// Direct Redis implementation without TypeScript
const { Redis } = require('@upstash/redis')

// Simple logger implementation
const logger = {
  info: (message, meta) => console.log(`[INFO] ${message}`, meta ? JSON.stringify(meta) : ''),
  error: (message, error, meta) => console.error(`[ERROR] ${message}`, error?.message || error, meta ? JSON.stringify(meta) : ''),
  warn: (message, meta) => console.warn(`[WARN] ${message}`, meta ? JSON.stringify(meta) : ''),
  debug: (message, meta) => console.log(`[DEBUG] ${message}`, meta ? JSON.stringify(meta) : '')
}

// Queue Manager Implementation
class QueueManager {
  constructor(redisUrl, redisToken, options = {}) {
    this.redis = new Redis({
      url: redisUrl,
      token: redisToken
    })
    
    this.processors = new Map()
    this.isProcessing = false
    this.concurrency = options.concurrency || 5
    this.defaultJobOptions = {
      priority: options.defaultJobOptions?.priority || 0,
      maxAttempts: options.defaultJobOptions?.maxAttempts || 3,
      delay: options.defaultJobOptions?.delay || 0
    }
  }

  async addJob(type, data, options = {}) {
    const jobId = options.id || `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const now = new Date().toISOString()
    const processAt = options.delay 
      ? new Date(Date.now() + options.delay).toISOString()
      : now

    const job = {
      id: jobId,
      type,
      data,
      priority: options.priority ?? this.defaultJobOptions.priority,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? this.defaultJobOptions.maxAttempts,
      ...(options.delay !== undefined && { delay: options.delay }),
      createdAt: now,
      processAt
    }

    // Store job in Redis
    await this.redis.hset(`job:${jobId}`, job)
    
    // Add to priority queue
    await this.redis.zadd('queue:waiting', {
      score: job.priority,
      member: jobId
    })

    // Add to delayed queue if needed
    if (options.delay) {
      await this.redis.zadd('queue:delayed', {
        score: Date.now() + options.delay,
        member: jobId
      })
    }

    logger.info('Job added to queue', {
      jobId,
      type,
      priority: job.priority,
      delay: options.delay,
      component: 'queue-manager'
    })

    return jobId
  }

  process(type, processor) {
    this.processors.set(type, processor)
    logger.info('Job processor registered', { type, component: 'queue-manager' })
  }

  async start() {
    if (this.isProcessing) {
      logger.warn('Queue processing already started', { component: 'queue-manager' })
      return
    }

    this.isProcessing = true
    logger.info('Starting queue processing', { 
      concurrency: this.concurrency,
      component: 'queue-manager' 
    })

    // Process delayed jobs
    this.processDelayedJobs()

    // Process waiting jobs
    this.processWaitingJobs()
  }

  async stop() {
    this.isProcessing = false
    logger.info('Stopping queue processing', { component: 'queue-manager' })
  }

  async processDelayedJobs() {
    if (!this.isProcessing) return

    try {
      const now = Date.now()
      
      // Get delayed jobs that are ready to process
      const readyJobs = await this.redis.zrange(
        'queue:delayed',
        '-inf',
        now,
        { byScore: true, withScores: true }
      )

      for (let i = 0; i < readyJobs.length; i += 2) {
        const jobId = readyJobs[i]
        
        // Move from delayed to waiting queue
        const job = await this.redis.hgetall(`job:${jobId}`)
        if (job) {
          await this.redis.zadd('queue:waiting', {
            score: job.priority,
            member: jobId
          })
          await this.redis.zrem('queue:delayed', jobId)
          
          logger.debug('Moved delayed job to waiting queue', {
            jobId,
            type: job.type,
            component: 'queue-manager'
          })
        }
      }
    } catch (error) {
      logger.error('Error processing delayed jobs', error, {
        component: 'queue-manager'
      })
    }

    // Schedule next check
    setTimeout(() => this.processDelayedJobs(), 1000)
  }

  async processWaitingJobs() {
    if (!this.isProcessing) return

    try {
      // Get jobs from waiting queue (highest priority first)
      const jobIds = await this.redis.zrange('queue:waiting', 0, this.concurrency - 1, { rev: true })
      
      if (jobIds.length === 0) {
        // No jobs to process, wait and try again
        setTimeout(() => this.processWaitingJobs(), 1000)
        return
      }

      // Process jobs concurrently
      const processingPromises = jobIds.map(jobId => this.processJob(jobId))
      await Promise.allSettled(processingPromises)

    } catch (error) {
      logger.error('Error processing waiting jobs', error, {
        component: 'queue-manager'
      })
    }

    // Continue processing
    setTimeout(() => this.processWaitingJobs(), 100)
  }

  async processJob(jobId) {
    try {
      // Get job details
      const jobData = await this.redis.hgetall(`job:${jobId}`)
      if (!jobData || !jobData['type']) {
        logger.warn('Job not found or invalid', { jobId, component: 'queue-manager' })
        await this.redis.zrem('queue:waiting', jobId)
        return
      }

      const job = jobData
      
      // Remove from waiting queue
      await this.redis.zrem('queue:waiting', jobId)
      
      // Check if we have a processor for this job type
      const processor = this.processors.get(job.type)
      if (!processor) {
        logger.error('No processor found for job type', undefined, {
          jobId,
          type: job.type,
          component: 'queue-manager'
        })
        await this.failJob(job, 'No processor found for job type')
        return
      }

      // Update job status
      job.attempts = parseInt(job.attempts) + 1
      await this.redis.hset(`job:${jobId}`, {
        attempts: job.attempts,
        startedAt: new Date().toISOString()
      })

      logger.info('Processing job', {
        jobId,
        type: job.type,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        component: 'queue-manager'
      })

      // Process the job
      await processor(job)

      // Mark job as completed
      await this.completeJob(job)

    } catch (error) {
      logger.error('Job processing failed', error, {
        jobId,
        component: 'queue-manager'
      })

      // Handle job failure
      const jobData = await this.redis.hgetall(`job:${jobId}`)
      if (jobData) {
        await this.handleJobFailure(jobData, error)
      }
    }
  }

  async completeJob(job) {
    await this.redis.hset(`job:${job.id}`, {
      completedAt: new Date().toISOString(),
      status: 'completed'
    })

    logger.info('Job completed successfully', {
      jobId: job.id,
      type: job.type,
      attempts: job.attempts,
      component: 'queue-manager'
    })

    // Clean up completed job after 24 hours
    await this.redis.expire(`job:${job.id}`, 86400)
  }

  async handleJobFailure(job, error) {
    const attempts = parseInt(job.attempts)
    const maxAttempts = parseInt(job.maxAttempts)
    
    if (attempts < maxAttempts) {
      // Retry the job with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempts - 1), 30000)
      
      await this.redis.zadd('queue:delayed', {
        score: Date.now() + delay,
        member: job.id
      })

      logger.warn('Job failed, retrying', {
        jobId: job.id,
        type: job.type,
        attempt: attempts,
        maxAttempts: maxAttempts,
        retryDelay: delay,
        error: error.message,
        component: 'queue-manager'
      })
    } else {
      // Max attempts reached, mark as failed
      await this.failJob(job, error.message)
    }
  }

  async failJob(job, errorMessage) {
    await this.redis.hset(`job:${job.id}`, {
      failedAt: new Date().toISOString(),
      error: errorMessage,
      status: 'failed'
    })

    logger.error('Job failed permanently', undefined, {
      jobId: job.id,
      type: job.type,
      attempts: job.attempts,
      error: errorMessage,
      component: 'queue-manager'
    })

    // Clean up failed job after 7 days
    await this.redis.expire(`job:${job.id}`, 604800)
  }

  async getQueueStats() {
    const [waiting, delayed] = await Promise.all([
      this.redis.zcard('queue:waiting'),
      this.redis.zcard('queue:delayed')
    ])

    return {
      waiting: waiting || 0,
      delayed: delayed || 0,
      processing: 0,
      completed: 0,
      failed: 0
    }
  }
}

// Simple job processors
async function processDocumentJob(job) {
  logger.info('Processing document job (simplified)', {
    jobId: job.id,
    documentId: job.data.documentId,
    component: 'document-processor'
  })
  
  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 2000))
  
  logger.info('Document job completed (simplified)', {
    jobId: job.id,
    documentId: job.data.documentId,
    component: 'document-processor'
  })
}

async function processBatchCompletionJob(job) {
  logger.info('Processing batch completion job (simplified)', {
    jobId: job.id,
    batchId: job.data.batchId,
    component: 'batch-processor'
  })
  
  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  logger.info('Batch completion job completed (simplified)', {
    jobId: job.id,
    batchId: job.data.batchId,
    component: 'batch-processor'
  })
}

async function processCleanupJob(job) {
  logger.info('Processing cleanup job', {
    jobId: job.id,
    type: job.data.type,
    component: 'cleanup-processor'
  })
  
  // Simulate cleanup
  await new Promise(resolve => setTimeout(resolve, 500))
  
  logger.info('Cleanup job completed', {
    jobId: job.id,
    type: job.data.type,
    component: 'cleanup-processor'
  })
}

// Main worker logic
let isShuttingDown = false

async function startWorker() {
  console.log('🚀 Starting PDF AI Assistant Queue Worker (Production)')
  console.log(`📅 Started at: ${new Date().toISOString()}`)
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`⚙️  Worker PID: ${process.pid}`)

  // Check environment variables
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.error('❌ Missing Redis configuration')
    process.exit(1)
  }

  try {
    // Initialize queue manager
    const queueManager = new QueueManager(
      process.env.UPSTASH_REDIS_REST_URL,
      process.env.UPSTASH_REDIS_REST_TOKEN,
      {
        concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5'),
        defaultJobOptions: {
          priority: 0,
          maxAttempts: 3,
          delay: 0
        }
      }
    )
    
    // Register job processors
    console.log('📋 Registering job processors...')
    
    queueManager.process('document-processing', processDocumentJob)
    console.log('✅ Document processing processor registered')
    
    queueManager.process('batch-completion', processBatchCompletionJob)
    console.log('✅ Batch completion processor registered')
    
    queueManager.process('cleanup', processCleanupJob)
    console.log('✅ Cleanup processor registered')

    // Start processing jobs
    console.log('🎬 Starting job processing...')
    await queueManager.start()
    
    console.log('✅ Queue worker is now running and processing jobs')
    console.log('📊 Worker settings:')
    console.log(`   • Concurrency: ${process.env.QUEUE_CONCURRENCY || 5} jobs`)
    console.log(`   • Max attempts: ${process.env.QUEUE_MAX_ATTEMPTS || 3}`)
    console.log(`   • Redis URL: ${process.env.UPSTASH_REDIS_REST_URL ? 'configured' : 'missing'}`)

    // Schedule periodic cleanup
    schedulePeriodicCleanup(queueManager)
    
    // Graceful shutdown handling
    process.on('SIGTERM', () => gracefulShutdown(queueManager, 'SIGTERM'))
    process.on('SIGINT', () => gracefulShutdown(queueManager, 'SIGINT'))
    process.on('uncaughtException', (error) => handleError(queueManager, error))
    process.on('unhandledRejection', (error) => handleError(queueManager, error))

  } catch (error) {
    console.error('❌ Failed to start queue worker:', error)
    process.exit(1)
  }
}

function schedulePeriodicCleanup(queueManager) {
  const cleanupInterval = parseInt(process.env.CLEANUP_INTERVAL_MS || '3600000') // 1 hour
  
  setInterval(async () => {
    if (isShuttingDown) return
    
    try {
      console.log('🧹 Scheduling periodic cleanup jobs...')
      
      // Schedule cleanup of old jobs
      await queueManager.addJob('cleanup', {
        type: 'old_jobs',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      }, {
        priority: -10 // Low priority
      })
      
      // Schedule cleanup of orphaned files
      await queueManager.addJob('cleanup', {
        type: 'orphaned_files',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }, {
        priority: -10 // Low priority
      })
      
      // Schedule cache cleanup
      await queueManager.addJob('cleanup', {
        type: 'cache_cleanup'
      }, {
        priority: -10 // Low priority
      })
      
      console.log('✅ Periodic cleanup jobs scheduled')
      
    } catch (error) {
      console.error('❌ Failed to schedule cleanup jobs:', error)
    }
  }, cleanupInterval)
  
  console.log(`🕐 Periodic cleanup scheduled every ${cleanupInterval / 1000 / 60} minutes`)
}

async function gracefulShutdown(queueManager, signal) {
  if (isShuttingDown) return
  
  console.log(`📴 Received ${signal}, starting graceful shutdown...`)
  isShuttingDown = true
  
  try {
    // Stop accepting new jobs
    await queueManager.stop()
    console.log('✅ Queue processing stopped')
    
    // Wait a bit for current jobs to finish
    console.log('⏳ Waiting for current jobs to complete...')
    await new Promise(resolve => setTimeout(resolve, 5000))
    
    console.log('✅ Graceful shutdown completed')
    process.exit(0)
    
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error)
    process.exit(1)
  }
}

function handleError(queueManager, error) {
  console.error('❌ Unhandled error in queue worker:', error)
  
  if (!isShuttingDown) {
    console.log('🔄 Attempting graceful shutdown due to error...')
    gracefulShutdown(queueManager, 'ERROR')
  }
}

// Health check endpoint
if (process.env.WORKER_HTTP_PORT) {
  const http = require('http')
  const port = parseInt(process.env.WORKER_HTTP_PORT)
  
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      try {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          pid: process.pid,
          memory: process.memoryUsage(),
          mode: 'production'
        }))
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          status: 'unhealthy',
          error: error.message,
          timestamp: new Date().toISOString()
        }))
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    }
  })
  
  server.listen(port, () => {
    console.log(`🏥 Health check server running on port ${port}`)
  })
}

// Start the worker
if (require.main === module) {
  startWorker().catch(error => {
    console.error('❌ Fatal error starting queue worker:', error)
    process.exit(1)
  })
}

module.exports = { startWorker }