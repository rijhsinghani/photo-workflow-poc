/**
 * Comprehensive Audit Logger for Photo Workflow CLI
 * 
 * Logs all decisions, errors, fallbacks, and processing events
 * in structured JSON format for analysis and debugging.
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const chalk = require('chalk');

class AuditLogger {
  constructor(options = {}) {
    this.outputDir = options.outputDir || './output';
    this.stageName = options.stageName || 'unknown';
    this.verbose = options.verbose || false;
    this.sessionId = uuidv4();
    this.startTime = new Date();
    
    // Create logs directory
    this.logDir = path.join(this.outputDir, 'logs');
    this.logFile = path.join(this.logDir, `${this.stageName}.json`);
    this.summaryFile = path.join(this.logDir, `${this.stageName}-summary.json`);
    this.errorLogFile = path.join(this.logDir, `${this.stageName}-errors.json`);
    
    // Initialize log arrays
    this.logs = [];
    this.errors = [];
    this.decisions = [];
    this.fallbacks = [];
    this.performance = [];
    
    // Performance tracking
    this.stageStartTime = null;
    this.currentOperationStartTime = null;
    
    this.initialize();
  }

  /**
   * Initialize logger and create necessary directories
   */
  async initialize() {
    try {
      await fs.ensureDir(this.logDir);
      
      // Create session start log
      this.logEvent('session_start', {
        sessionId: this.sessionId,
        stageName: this.stageName,
        timestamp: this.startTime.toISOString(),
        environment: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          cwd: process.cwd()
        }
      });
      
      if (this.verbose) {
        console.log(chalk.blue(`[AUDIT] Initialized logger for stage: ${this.stageName}`));
        console.log(chalk.gray(`Session ID: ${this.sessionId}`));
        console.log(chalk.gray(`Log file: ${this.logFile}`));
      }
    } catch (error) {
      console.error(chalk.red(`[AUDIT] Failed to initialize logger: ${error.message}`));
    }
  }

  /**
   * Log a general event
   */
  logEvent(eventType, data = {}, level = 'info') {
    const logEntry = {
      id: uuidv4(),
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      stage: this.stageName,
      eventType,
      level,
      data,
      memoryUsage: this.getMemoryUsage()
    };

    this.logs.push(logEntry);
    
    if (this.verbose) {
      const color = this.getLevelColor(level);
      console.log(color(`[AUDIT] ${eventType}: ${JSON.stringify(data, null, 0)}`));
    }
    
    // Write to file immediately for critical events
    if (level === 'error' || level === 'critical') {
      this.flushLogs();
    }
  }

  /**
   * Log a decision made by the system
   */
  logDecision(decisionType, context, outcome, reasoning) {
    const decision = {
      id: uuidv4(),
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      stage: this.stageName,
      decisionType,
      context,
      outcome,
      reasoning,
      confidence: context.confidence || null
    };

    this.decisions.push(decision);
    
    this.logEvent('decision', {
      type: decisionType,
      outcome,
      reasoning: reasoning.substring(0, 100) + (reasoning.length > 100 ? '...' : '')
    }, 'info');

    if (this.verbose) {
      console.log(chalk.cyan(`[DECISION] ${decisionType}: ${outcome}`));
      console.log(chalk.gray(`  Reason: ${reasoning}`));
    }
  }

  /**
   * Log an error with context
   */
  logError(error, context = {}, severity = 'error') {
    const errorEntry = {
      id: uuidv4(),
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      stage: this.stageName,
      severity,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
        code: error.code || null
      },
      context,
      recoverable: context.recoverable !== undefined ? context.recoverable : true
    };

    this.errors.push(errorEntry);
    
    this.logEvent('error', {
      message: error.message,
      severity,
      context: Object.keys(context).length > 0 ? context : null
    }, severity);

    if (this.verbose || severity === 'critical') {
      console.error(chalk.red(`[ERROR] ${error.message}`));
      if (context.file) {
        console.error(chalk.gray(`  File: ${context.file}`));
      }
      if (context.operation) {
        console.error(chalk.gray(`  Operation: ${context.operation}`));
      }
    }
  }

  /**
   * Log a fallback scenario
   */
  logFallback(fallbackType, originalMethod, fallbackMethod, reason, success = true) {
    const fallback = {
      id: uuidv4(),
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      stage: this.stageName,
      fallbackType,
      originalMethod,
      fallbackMethod,
      reason,
      success
    };

    this.fallbacks.push(fallback);
    
    this.logEvent('fallback', {
      type: fallbackType,
      from: originalMethod,
      to: fallbackMethod,
      reason,
      success
    }, success ? 'warn' : 'error');

    if (this.verbose) {
      const color = success ? chalk.yellow : chalk.red;
      console.log(color(`[FALLBACK] ${originalMethod} → ${fallbackMethod}`));
      console.log(chalk.gray(`  Reason: ${reason}`));
    }
  }

  /**
   * Log performance metrics
   */
  logPerformance(operation, duration, metadata = {}) {
    const perfEntry = {
      id: uuidv4(),
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      stage: this.stageName,
      operation,
      duration,
      metadata,
      memoryUsage: this.getMemoryUsage()
    };

    this.performance.push(perfEntry);
    
    this.logEvent('performance', {
      operation,
      duration: `${duration}ms`,
      metadata
    }, 'info');

    if (this.verbose) {
      console.log(chalk.magenta(`[PERF] ${operation}: ${duration}ms`));
      if (Object.keys(metadata).length > 0) {
        console.log(chalk.gray(`  Meta: ${JSON.stringify(metadata, null, 0)}`));
      }
    }
  }

  /**
   * Start timing an operation
   */
  startOperation(operationName) {
    this.currentOperationStartTime = Date.now();
    this.currentOperationName = operationName;
    
    this.logEvent('operation_start', {
      operation: operationName
    });
  }

  /**
   * End timing an operation
   */
  endOperation(metadata = {}) {
    if (this.currentOperationStartTime && this.currentOperationName) {
      const duration = Date.now() - this.currentOperationStartTime;
      
      this.logPerformance(this.currentOperationName, duration, metadata);
      
      this.logEvent('operation_end', {
        operation: this.currentOperationName,
        duration
      });
      
      this.currentOperationStartTime = null;
      this.currentOperationName = null;
    }
  }

  /**
   * Start stage timing
   */
  startStage() {
    this.stageStartTime = Date.now();
    this.logEvent('stage_start', {
      stage: this.stageName
    });
  }

  /**
   * End stage timing and generate summary
   */
  async endStage(summary = {}) {
    const stageDuration = this.stageStartTime ? Date.now() - this.stageStartTime : 0;
    
    // Generate comprehensive summary
    const stageSummary = {
      sessionId: this.sessionId,
      stageName: this.stageName,
      startTime: this.startTime.toISOString(),
      endTime: new Date().toISOString(),
      duration: stageDuration,
      totalEvents: this.logs.length,
      totalErrors: this.errors.length,
      totalDecisions: this.decisions.length,
      totalFallbacks: this.fallbacks.length,
      performanceMetrics: this.performance.length,
      summary,
      stats: {
        errorRate: this.logs.length > 0 ? (this.errors.length / this.logs.length) * 100 : 0,
        avgOperationTime: this.performance.length > 0 
          ? this.performance.reduce((sum, p) => sum + p.duration, 0) / this.performance.length 
          : 0,
        memoryPeakUsage: Math.max(...this.logs.map(l => l.memoryUsage?.heapUsed || 0))
      }
    };
    
    this.logEvent('stage_end', {
      stage: this.stageName,
      duration: stageDuration,
      summary: stageSummary.stats
    });

    // Write all log files
    await this.flushLogs();
    await this.writeSummary(stageSummary);

    if (this.verbose) {
      console.log(chalk.blue(`[AUDIT] Stage completed: ${this.stageName}`));
      console.log(chalk.gray(`Duration: ${stageDuration}ms`));
      console.log(chalk.gray(`Events: ${this.logs.length}, Errors: ${this.errors.length}`));
    }
  }

  /**
   * Write logs to file
   */
  async flushLogs() {
    try {
      // Write main log file
      await fs.writeJson(this.logFile, this.logs, { spaces: 2 });
      
      // Write error log file if there are errors
      if (this.errors.length > 0) {
        await fs.writeJson(this.errorLogFile, this.errors, { spaces: 2 });
      }
      
      // Write structured data files
      const structuredData = {
        sessionId: this.sessionId,
        stage: this.stageName,
        timestamp: new Date().toISOString(),
        events: this.logs,
        errors: this.errors,
        decisions: this.decisions,
        fallbacks: this.fallbacks,
        performance: this.performance
      };
      
      const structuredFile = path.join(this.logDir, `${this.stageName}-structured.json`);
      await fs.writeJson(structuredFile, structuredData, { spaces: 2 });
      
    } catch (error) {
      console.error(chalk.red(`[AUDIT] Failed to flush logs: ${error.message}`));
    }
  }

  /**
   * Write summary to file
   */
  async writeSummary(summary) {
    try {
      await fs.writeJson(this.summaryFile, summary, { spaces: 2 });
    } catch (error) {
      console.error(chalk.red(`[AUDIT] Failed to write summary: ${error.message}`));
    }
  }

  /**
   * Get current memory usage
   */
  getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
      rss: usage.rss,
      heapTotal: usage.heapTotal,
      heapUsed: usage.heapUsed,
      external: usage.external
    };
  }

  /**
   * Get color for log level
   */
  getLevelColor(level) {
    const colors = {
      debug: chalk.gray,
      info: chalk.blue,
      warn: chalk.yellow,
      error: chalk.red,
      critical: chalk.magenta
    };
    return colors[level] || chalk.white;
  }

  /**
   * Get all logs
   */
  getLogs() {
    return {
      events: this.logs,
      errors: this.errors,
      decisions: this.decisions,
      fallbacks: this.fallbacks,
      performance: this.performance
    };
  }

  /**
   * Get summary statistics
   */
  getStats() {
    return {
      totalEvents: this.logs.length,
      totalErrors: this.errors.length,
      totalDecisions: this.decisions.length,
      totalFallbacks: this.fallbacks.length,
      sessionDuration: Date.now() - this.startTime.getTime(),
      errorRate: this.logs.length > 0 ? (this.errors.length / this.logs.length) * 100 : 0
    };
  }
}

module.exports = AuditLogger;