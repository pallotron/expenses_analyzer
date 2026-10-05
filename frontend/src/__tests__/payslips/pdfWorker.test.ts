import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * pdf.js itself is mocked: what matters is that every parse shares one worker
 * and always destroys its loading task, so no worker outlives its file.
 */
const pdfjs = vi.hoisted(() => {
  const workers: object[] = [];
  const tasks: { destroy: ReturnType<typeof vi.fn>; params: { worker?: object } }[] = [];
  let outcome: "ok" | "password" | "broken" = "ok";
  class PDFWorker {
    destroyed = false;
    constructor() { workers.push(this); }
  }
  const page = { getTextContent: async () => ({ items: [{ str: "Salary 1.00", transform: [1, 0, 0, 1, 10, 700] }] }) };
  const getDocument = vi.fn((params: { worker?: object }) => {
    const promise = outcome === "ok"
      ? Promise.resolve({ numPages: 1, getPage: async () => page })
      : Promise.reject(Object.assign(new Error("nope"), { name: outcome === "password" ? "PasswordException" : "InvalidPDFException" }));
    const task = { params, promise, destroy: vi.fn(async () => {}) };
    tasks.push(task);
    return task;
  });
  return {
    workers, tasks, getDocument, PDFWorker,
    set outcome(o: "ok" | "password" | "broken") { outcome = o; },
  };
});

vi.mock("pdfjs-dist", () => ({ getDocument: pdfjs.getDocument, PDFWorker: pdfjs.PDFWorker, GlobalWorkerOptions: {} }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "pdf.worker.js" }));

import { extractTextLines, PayslipDecryptError } from "../../payslips/pdf";

afterEach(() => { pdfjs.outcome = "ok"; });

describe("extractTextLines", () => {
  it("creates no worker until the first parse", () => {
    expect(pdfjs.workers).toHaveLength(0);
  });

  it("reads the text and destroys the loading task", async () => {
    expect(await extractTextLines(new ArrayBuffer(1))).toEqual(["Salary 1.00"]);
    expect(pdfjs.tasks.at(-1)!.destroy).toHaveBeenCalledOnce();
  });

  it("destroys the loading task when the password is wrong", async () => {
    pdfjs.outcome = "password";
    await expect(extractTextLines(new ArrayBuffer(1), "bad")).rejects.toBeInstanceOf(PayslipDecryptError);
    expect(pdfjs.tasks.at(-1)!.destroy).toHaveBeenCalledOnce();
  });

  it("destroys the loading task when the file is broken", async () => {
    pdfjs.outcome = "broken";
    await expect(extractTextLines(new ArrayBuffer(1))).rejects.toThrow("nope");
    expect(pdfjs.tasks.at(-1)!.destroy).toHaveBeenCalledOnce();
  });

  it("passes the same worker to every parse", async () => {
    await extractTextLines(new ArrayBuffer(1));
    await extractTextLines(new ArrayBuffer(1));
    expect(pdfjs.workers).toHaveLength(1);
    const used = pdfjs.tasks.map((t) => t.params.worker);
    expect(used.every((w) => w === pdfjs.workers[0])).toBe(true);
  });
});
