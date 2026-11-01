import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Layout, { metadata } from "./layout";
import Forbidden from "./forbidden/page";
vi.mock("next/font/google", () => ({ Geist: () => ({ variable: "test-font" }) }));
it("provides the application document language, title and its page content", () => {
  const html = renderToStaticMarkup(<Layout params={Promise.resolve({})}><main>Event workspace</main></Layout>);
  expect(html).toContain('lang="en"'); expect(html).toContain("Event workspace");
  expect(metadata.title).toBe("ConnectSphere");
  expect(html).toContain("test-font");
});
it("explains access denial and offers a route home without management actions", () => {
  const html = renderToStaticMarkup(<Forbidden />);
  expect(html).toContain("Access denied"); expect(html).toContain("current role");
  expect(html).toContain('href="/"'); expect(html).toContain("Back to overview");
  expect(html).not.toContain("<form");
});
