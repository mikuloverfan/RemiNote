// ============================================================
//  LogManager — 统一日志控制塔
//  __DEBUG_MODE = false → 除 error 外全部静默
//  __DEBUG_FILTER 控制分类开关
//  console.error 始终输出
// ============================================================

if (typeof window !== "undefined") {
  if ((window as any).__DEBUG_MODE === undefined) {
    (window as any).__DEBUG_MODE = false;
  }
  if (!(window as any).__DEBUG_FILTER) {
    (window as any).__DEBUG_FILTER = {
      watchdog: false,
      session: false,
      render: false,
      pipeline: false,
      lifecycle: false,
      main: false,
      inkfield: false,
      workspace: false,
      gpu: false,
    };
  }
}

function allowed(type: string): boolean {
  if (!(window as any).__DEBUG_MODE) return false;
  return !!(window as any).__DEBUG_FILTER?.[type];
}

const LogManager = {
  debug(type: string, ...args: any[]) { if (allowed(type)) console.log(`[${type}]`, ...args); },
  info(type: string, ...args: any[])  { if (allowed(type)) console.log(`[${type}]`, ...args); },
  log(type: string, ...args: any[])   { if (allowed(type)) console.log(`[${type}]`, ...args); },
  warn(type: string, ...args: any[])  { if (allowed(type)) console.warn(`[${type}]`, ...args); },
  // error 始终通过，不受 __DEBUG_MODE 控制
  error(type: string, ...args: any[]) { console.error(`[${type}]`, ...args); },
};

export default LogManager;
