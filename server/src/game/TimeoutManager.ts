export class TimeoutManager {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  /** 为指定房间启动一个 30 秒倒计时；若已有旧计时器则先清除 */
  startTimer(roomId: string, _playerId: string, onTimeout: () => void): void {
    this.clearTimer(roomId);
    const handle = setTimeout(onTimeout, 30_000);
    this.timers.set(roomId, handle);
  }

  /** 清除指定房间的计时器 */
  clearTimer(roomId: string): void {
    const handle = this.timers.get(roomId);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.timers.delete(roomId);
    }
  }

  /** 清除所有计时器（服务器关闭时调用） */
  clearAll(): void {
    for (const handle of this.timers.values()) {
      clearTimeout(handle);
    }
    this.timers.clear();
  }
}
