import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";

const createBrowserClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({ createClient: createBrowserClientMock }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  createBrowserClientMock.mockReset();
  document.documentElement.lang = "en";
  window.history.replaceState(null, "", "/");
});

const fulfilledSearchParams = Object.assign(Promise.resolve({ lang: "en" }), {
  status: "fulfilled",
  value: { lang: "en" },
});

const fulfilledChineseSearchParams = Object.assign(Promise.resolve({ lang: "zh-CN" }), {
  status: "fulfilled",
  value: { lang: "zh-CN" },
});

beforeEach(() => {
  createBrowserClientMock.mockReturnValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
  });
});

describe("Landing templates", () => {
  it("shows the signed-in account and workspace link on the homepage", async () => {
    createBrowserClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { email: "qa@example.com" } } }),
      },
    });

    render(<Home searchParams={fulfilledSearchParams as never} />);

    expect((await screen.findByRole("link", { name: "qa@example.com" })).getAttribute("href")).toBe("/dashboard?lang=en");
    expect(screen.getByRole("link", { name: "Open workspace" }).getAttribute("href")).toBe("/dashboard?lang=en");
    expect(screen.queryByRole("link", { name: "Log in" })).toBeNull();
  });

  it("prefills the hero request without navigating to the rules page", () => {
    render(<Home searchParams={fulfilledSearchParams as never} />);

    const templates = [
      ["Creator updates", "Track official creator releases, tours and partnerships from trusted public sources."],
      ["Company announcements", "Track official company product launches, pricing and leadership changes."],
      ["Industry intelligence", "Track important industry launches, research and regulation from trusted public sources."],
      ["Job opportunities", "Track job opportunities matching location, title and requirements from trusted public sources."],
    ];

    for (const [title, request] of templates) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(title, "i") }));

      expect((screen.getAllByRole("textbox")[0] as HTMLInputElement).value).toBe(request);
      expect(screen.queryByRole("link", { name: new RegExp(title, "i") })).toBeNull();
    }
  });

  it("shows finding evidence, flow connectors, and a footer on the landing page", () => {
    render(<Home searchParams={fulfilledSearchParams as never} />);

    const proofSection = screen.getByRole("heading", { name: "See exactly what your Radar is doing." }).closest("section");

    expect(proofSection).toBeTruthy();
    expect(within(proofSection as HTMLElement).getAllByRole("article")).toHaveLength(1);
    expect(within(proofSection as HTMLElement).getByText("New single announcement")).toBeTruthy();
    expect(within(proofSection as HTMLElement).getByText("Official source · Found 8 minutes ago")).toBeTruthy();
    expect(within(proofSection as HTMLElement).queryByText("Source: Official announcement")).toBeNull();
    expect(within(proofSection as HTMLElement).queryByText("Source checked")).toBeNull();
    expect(within(proofSection as HTMLElement).queryByRole("button", { name: /View source/ })).toBeNull();
    expect(screen.getAllByText(/View source/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Source:")).toHaveLength(2);
    expect(screen.getByText("Official announcement")).toBeTruthy();
    expect(screen.getAllByLabelText("Next step")).toHaveLength(2);
    expect(screen.getByText("© 2026 Watch Anything")).toBeTruthy();
  });

  it("points Get started at the hero request area", () => {
    createBrowserClientMock.mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });

    render(<Home searchParams={fulfilledSearchParams as never} />);

    expect(screen.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/auth?lang=en");
    expect(screen.getByRole("link", { name: "Get started" }).getAttribute("href")).toBe(
      "/?lang=en#hero-request",
    );
  });

  it("uses the prototype typography scale for the landing hierarchy", () => {
    createBrowserClientMock.mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });

    render(<Home searchParams={fulfilledSearchParams as never} />);

    expect(screen.getByRole("heading", { name: /Never misswhat matters/ }).className).toContain(
      "min-[850px]:text-[64px]",
    );
    expect(screen.getByRole("heading", { name: /Never misswhat matters/ }).className).toContain(
      "min-[850px]:leading-[0.99]",
    );
    expect(screen.getByRole("heading", { name: "See exactly what your Radar is doing." }).className).toContain(
      "min-[850px]:text-[42px]",
    );
    expect(screen.getByRole("heading", { name: "From an imperfect idea to a reliable signal." }).className).toContain(
      "min-[850px]:text-[38px]",
    );
    expect(screen.getByRole("heading", { name: "Build a Radar before you create an account." }).parentElement?.className).toContain(
      "rounded-3xl",
    );
  });

  it("keeps the bottom CTA on the same request contract as the hero", () => {
    render(<Home searchParams={fulfilledSearchParams as never} />);

    const previewLink = screen.getByRole("link", { name: "Preview my radar" });
    fireEvent.click(previewLink);
    expect(screen.getAllByRole("alert").at(-1)?.textContent).toContain(
      "Tell us what you would like to monitor.",
    );

    fireEvent.change(screen.getAllByRole("textbox")[1], {
      target: { value: "Track official OpenAI model releases" },
    });
    expect(previewLink.getAttribute("href")).toContain(
      "request=Track%20official%20OpenAI%20model%20releases",
    );
    expect(screen.getByPlaceholderText("Describe what matters to you")).toBeTruthy();
  });

  it("submits the bottom CTA from the keyboard", () => {
    render(<Home searchParams={fulfilledSearchParams as never} />);

    const input = screen.getAllByRole("textbox")[1];
    fireEvent.change(input, { target: { value: "Track official OpenAI model releases" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(screen.getByRole("link", { name: "Preview my radar" }).getAttribute("href")).toContain(
      "request=Track%20official%20OpenAI%20model%20releases",
    );
  });

  it("updates the document language for the selected landing locale", async () => {
    render(<Home searchParams={fulfilledChineseSearchParams as never} />);

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("zh-CN");
    });
  });

  it("keeps the current section anchor when switching landing locales", async () => {
    window.history.replaceState(null, "", "/?lang=en#templates");
    render(<Home searchParams={fulfilledSearchParams as never} />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "中文" }).getAttribute("href")).toBe(
        "/?lang=zh-CN#templates",
      );
    });
  });
});
