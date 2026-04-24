import { describe, expect, it } from "vitest";
import { CircuitBreaker, type CircuitBreakerConfig } from "./circuit-breaker.js";

interface ErrorWithCode extends Error {
  code?: string;
}

describe("CircuitBreaker", () => {
  it("starts in CLOSED state", () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe("CLOSED");
  });

  it("records failures and opens circuit after threshold", () => {
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 1,
      timeoutMs: 100,
      halfOpenMaxRequests: 1,
    });

    for (let i = 0; i < 3; i++) {
      cb.recordFailure(new Error("test error"));
    }

    expect(cb.getState()).toBe("OPEN");
    expect(cb.isAvailable()).toBe(false);
  });

  it("transitions OPEN to HALF_OPEN after timeout", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      timeoutMs: 50,
      halfOpenMaxRequests: 1,
    });

    cb.recordFailure(new Error("test error"));
    expect(cb.getState()).toBe("OPEN");

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(cb.getState()).toBe("HALF_OPEN");
    expect(cb.isAvailable()).toBe(true);
  });

  it("records successes and closes from HALF_OPEN", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 2,
      timeoutMs: 50,
      halfOpenMaxRequests: 2,
    });

    cb.recordFailure(new Error("test error"));
    expect(cb.getState()).toBe("OPEN");

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(cb.getState()).toBe("HALF_OPEN");

    cb.recordSuccess();
    cb.recordSuccess();

    expect(cb.getState()).toBe("CLOSED");
  });

  it("records connection errors with double failure count", () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      successThreshold: 1,
      timeoutMs: 100,
      halfOpenMaxRequests: 1,
    });

    const err = new Error("ECONNREFUSED connection test") as ErrorWithCode;
    err.code = "ECONNREFUSED";
    cb.recordFailure(err);

    const err2 = new Error("ECONNRESET connection test") as ErrorWithCode;
    err2.code = "ECONNRESET";
    cb.recordFailure(err2);

    expect(cb.getState()).toBe("OPEN");
  });

  it("allows requests in CLOSED and HALF_OPEN states", () => {
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      timeoutMs: 100,
      halfOpenMaxRequests: 2,
    });

    expect(cb.isAvailable()).toBe(true);

    cb.recordFailure(new Error("test"));
    expect(cb.isAvailable()).toBe(true);

    cb.recordFailure(new Error("test"));
    expect(cb.isAvailable()).toBe(true);

    cb.recordFailure(new Error("test"));
    expect(cb.isAvailable()).toBe(false);

    cb.recordFailure(new Error("test"));
    expect(cb.isAvailable()).toBe(false);

    cb.recordFailure(new Error("test"));
    expect(cb.getState()).toBe("OPEN");
    expect(cb.isAvailable()).toBe(false);
  });

  it("resets state on success in CLOSED state", () => {
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 1,
      timeoutMs: 100,
      halfOpenMaxRequests: 1,
    });

    cb.recordFailure(new Error("test1"));
    cb.recordFailure(new Error("test2"));
    expect(cb.getFailureCount()).toBeGreaterThan(0);

    cb.recordSuccess();
    expect(cb.getFailureCount()).toBe(0);
  });

  it("executes function and records success", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 1,
      timeoutMs: 100,
      halfOpenMaxRequests: 1,
    });

    const result = await cb.execute(() => Promise.resolve("success"));
    expect(result).toBe("success");
    expect(cb.getState()).toBe("CLOSED");
  });

  it("executes function and records failure", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      timeoutMs: 100,
      halfOpenMaxRequests: 1,
    });

    await expect(cb.execute(() => Promise.reject(new Error("test error")))).rejects.toThrow(
      "test error",
    );
    expect(cb.getState()).toBe("OPEN");
  });

  it("throws error when circuit is open", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 1,
      timeoutMs: 100,
      halfOpenMaxRequests: 1,
    });

    cb.recordFailure(new Error("test error"));
    await expect(cb.execute(() => Promise.resolve("success"))).rejects.toThrow(
      "Circuit breaker open: gateway unavailable",
    );
  });

  it("allows limited requests in half-open state", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 2,
      timeoutMs: 50,
      halfOpenMaxRequests: 2,
    });

    cb.recordFailure(new Error("test error"));
    await new Promise((resolve) => setTimeout(resolve, 60));

    const allowed1 = await cb.allowRequest();
    const allowed2 = await cb.allowRequest();
    const allowed3 = await cb.allowRequest();

    expect(allowed1).toBe(true);
    expect(allowed2).toBe(true);
    expect(allowed3).toBe(false);
  });

  it("configurable thresholds work correctly", () => {
    const config: CircuitBreakerConfig = {
      failureThreshold: 10,
      successThreshold: 5,
      timeoutMs: 60000,
      halfOpenMaxRequests: 3,
    };
    const cb = new CircuitBreaker(config);

    expect(cb.getConfig()).toEqual(config);
  });
});
