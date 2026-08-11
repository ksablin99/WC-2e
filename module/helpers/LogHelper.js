export class LogLevel {
  static DEBUG = 0;
  static INFO = 1;
  static WARN = 2;
  static ERROR = 3;
  static FATAL = 4;
}

export class LogHelper {
  static logLevel = LogLevel.DEBUG;

  static setLogLevel(level) {
    LogHelper.logLevel = level;
  }

  static log(...data) {
    if (LogHelper.logLevel > LogLevel.DEBUG) return;
    if (data.length === 1 && typeof data[0] === 'object') {
      console.log('D35E |', JSON.stringify(data[0], null, 2));
      return;
    }
    console.log('D35E |', ...data);
  }

  static info(...data) {
    if (LogHelper.logLevel > LogLevel.INFO) return;
    if (data.length === 1 && typeof data[0] === 'object') {
      console.info('D35E |', JSON.stringify(data[0], null, 2));
      return;
    }
    console.info('D35E |', ...data);
  }

  static warn(...data) {
    if (LogHelper.logLevel > LogLevel.WARN) return;
    console.warn('D35E |', ...data);
  }

  static error(...data) {
    if (LogHelper.logLevel > LogLevel.ERROR) return;
    if (data.length === 1 && typeof data[0] === 'object') {
      console.error('D35E |', JSON.stringify(data[0], null, 2));
      return;
    }
    console.error('D35E |', ...data);
  }

  static debug(...data) {
    if (LogHelper.logLevel > LogLevel.DEBUG) return;
    if (data.length === 1 && typeof data[0] === 'object') {
      console.debug('D35E |', JSON.stringify(data[0], null, 2));
      return;
    }
    console.debug('D35E |', ...data);
  }

  static startTimer(name) {
    if (LogHelper.logLevel !== LogLevel.DEBUG) return;
    console.time(name);
  }

  static getTime(name) {
    if (LogHelper.logLevel !== LogLevel.DEBUG) return;
    console.timeEnd(name);
  }
}
