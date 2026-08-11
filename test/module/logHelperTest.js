import { LogHelper, LogLevel } from '../../module/helpers/LogHelper.js';

describe('LogHelper', () => {
  let origLevel;
  let calls;

  beforeEach(() => {
    origLevel = LogHelper.logLevel;
    LogHelper.logLevel = LogLevel.DEBUG; // allow all output

    calls = { log: [], info: [], warn: [], error: [], debug: [] };
    jest.spyOn(console, 'log').mockImplementation((...a) => calls.log.push(a));
    jest.spyOn(console, 'info').mockImplementation((...a) => calls.info.push(a));
    jest.spyOn(console, 'warn').mockImplementation((...a) => calls.warn.push(a));
    jest.spyOn(console, 'error').mockImplementation((...a) => calls.error.push(a));
    jest.spyOn(console, 'debug').mockImplementation((...a) => calls.debug.push(a));
  });

  afterEach(() => {
    LogHelper.logLevel = origLevel;
    jest.restoreAllMocks();
  });

  // ── Prefix ─────────────────────────────────────────────────────────────────

  it('log() prefixes output with "D35E |"', () => {
    LogHelper.log('hello');
    expect(calls.log[0][0]).toBe('D35E |');
    expect(calls.log[0][1]).toBe('hello');
  });

  it('warn() prefixes output with "D35E |"', () => {
    LogHelper.warn('something');
    expect(calls.warn[0][0]).toBe('D35E |');
  });

  it('error() prefixes output with "D35E |"', () => {
    LogHelper.error('oops');
    expect(calls.error[0][0]).toBe('D35E |');
  });

  it('info() prefixes output with "D35E |"', () => {
    LogHelper.info('note');
    expect(calls.info[0][0]).toBe('D35E |');
  });

  it('debug() prefixes output with "D35E |"', () => {
    LogHelper.debug('verbose');
    expect(calls.debug[0][0]).toBe('D35E |');
  });

  // ── Variadic args — the core bug regression ────────────────────────────────
  // Previously, methods accepted (data) instead of (...data). Calling them
  // with multiple args (e.g. LogHelper.error('D35E | ', err)) spread the first
  // string argument character-by-character, producing garbage output.

  it('log() passes all arguments through, not just the first', () => {
    LogHelper.log('a', 'b', 'c');
    expect(calls.log[0]).toEqual(['D35E |', 'a', 'b', 'c']);
  });

  it('warn() passes all arguments through', () => {
    LogHelper.warn('x', 42, { key: 'val' });
    expect(calls.warn[0]).toEqual(['D35E |', 'x', 42, { key: 'val' }]);
  });

  it('error() passes all arguments through', () => {
    const err = new Error('boom');
    LogHelper.error('something went wrong', err);
    expect(calls.error[0][0]).toBe('D35E |');
    expect(calls.error[0][1]).toBe('something went wrong');
    expect(calls.error[0][2]).toBe(err);
  });

  it('error() does not spread string characters (regression)', () => {
    // Old behaviour: LogHelper.error('msg') → console.error(...'msg') → ['m','s','g']
    LogHelper.error('msg');
    // Must be two args: the prefix + the string — NOT individual characters
    expect(calls.error[0]).toHaveLength(2);
    expect(calls.error[0][1]).toBe('msg');
  });

  it('info() does not spread string characters (regression)', () => {
    LogHelper.info('info msg');
    expect(calls.info[0]).toHaveLength(2);
    expect(calls.info[0][1]).toBe('info msg');
  });

  it('debug() does not spread string characters (regression)', () => {
    LogHelper.debug('dbg');
    expect(calls.debug[0]).toHaveLength(2);
    expect(calls.debug[0][1]).toBe('dbg');
  });

  // ── Single-object JSON serialisation ──────────────────────────────────────

  it('log() JSON-serialises a single object argument', () => {
    LogHelper.log({ foo: 1 });
    expect(calls.log[0][0]).toBe('D35E |');
    expect(calls.log[0][1]).toContain('"foo": 1');
  });

  it('error() JSON-serialises a single object argument', () => {
    LogHelper.error({ code: 404 });
    expect(calls.error[0][1]).toContain('"code": 404');
  });

  // ── Log level filtering ────────────────────────────────────────────────────

  it('suppresses log() when level is above DEBUG', () => {
    LogHelper.logLevel = LogLevel.WARN;
    LogHelper.log('hidden');
    expect(calls.log).toHaveLength(0);
  });

  it('suppresses info() when level is above INFO', () => {
    LogHelper.logLevel = LogLevel.WARN;
    LogHelper.info('hidden');
    expect(calls.info).toHaveLength(0);
  });

  it('suppresses warn() when level is above WARN', () => {
    LogHelper.logLevel = LogLevel.ERROR;
    LogHelper.warn('hidden');
    expect(calls.warn).toHaveLength(0);
  });

  it('allows warn() at WARN level', () => {
    LogHelper.logLevel = LogLevel.WARN;
    LogHelper.warn('visible');
    expect(calls.warn).toHaveLength(1);
  });

  it('allows error() at WARN level', () => {
    LogHelper.logLevel = LogLevel.WARN;
    LogHelper.error('visible');
    expect(calls.error).toHaveLength(1);
  });
});
