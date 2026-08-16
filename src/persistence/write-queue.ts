export class SerialWriteQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(write: () => Promise<T>): Promise<T> {
    const result = this.tail.then(write, write);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
