import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
afterEach(cleanup);
export { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
