import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWatchlist } from "@/hooks/useWatchlist";

describe("useWatchlist", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("initial fetch", () => {
    it("starts in 'loading' state", () => {
      vi.mocked(fetch).mockImplementation(() => new Promise(() => {})); // never resolves
      const { result } = renderHook(() => useWatchlist("AAPL", "p1"));
      expect(result.current.status).toBe("loading");
    });

    it("transitions to 'watching' when API returns { watching: true }", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ watching: true }),
      } as any);

      const { result } = renderHook(() => useWatchlist("AAPL", "p1"));
      await waitFor(() => expect(result.current.status).toBe("watching"));
    });

    it("transitions to 'not_watching' when API returns { watching: false }", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ watching: false }),
      } as any);

      const { result } = renderHook(() => useWatchlist("AAPL", "p1"));
      await waitFor(() => expect(result.current.status).toBe("not_watching"));
    });

    it("transitions to 'error' when fetch throws", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"));
      const { result } = renderHook(() => useWatchlist("AAPL", "p1"));
      await waitFor(() => expect(result.current.status).toBe("error"));
    });

    it("transitions to 'error' when response is not ok", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Server error" }),
      } as any);

      const { result } = renderHook(() => useWatchlist("AAPL", "p1"));
      await waitFor(() => expect(result.current.status).toBe("error"));
    });

    it("sets status to 'not_watching' immediately when portfolioId is null (no fetch)", () => {
      const { result } = renderHook(() => useWatchlist("AAPL", null));
      expect(result.current.status).toBe("not_watching");
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("re-fetch on dependency change", () => {
    it("re-fetches when ticker changes", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ watching: false }),
      } as any);

      const { rerender } = renderHook(
        ({ ticker }: { ticker: string }) => useWatchlist(ticker, "p1"),
        { initialProps: { ticker: "AAPL" } }
      );

      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      rerender({ ticker: "TSLA" });
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    });
  });

  describe("toggle", () => {
    it("does nothing if status is 'loading'", async () => {
      vi.mocked(fetch).mockImplementation(() => new Promise(() => {})); // stays loading
      const { result } = renderHook(() => useWatchlist("AAPL", "p1"));
      
      await act(async () => {
        await result.current.toggle();
      });
      expect(result.current.status).toBe("loading");
    });

    it("does nothing if portfolioId is null", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ watching: false }),
      } as any);
      
      const { result } = renderHook(() => useWatchlist("AAPL", null));
      const callsBefore = vi.mocked(fetch).mock.calls.length;
      
      await act(async () => {
        await result.current.toggle();
      });
      expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore);
    });

    it("optimistically sets status to 'not_watching' when currently 'watching'", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ watching: true }) } as any)
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as any); // DELETE

      const { result } = renderHook(() => useWatchlist("AAPL", "p1"));
      await waitFor(() => expect(result.current.status).toBe("watching"));

      act(() => { result.current.toggle(); });
      // Immediately after calling toggle (optimistic)
      expect(result.current.status).toBe("not_watching");
    });

    it("calls DELETE when status was 'watching'", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ watching: true }) } as any)
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as any);

      const { result } = renderHook(() => useWatchlist("AAPL", "p1"));
      await waitFor(() => expect(result.current.status).toBe("watching"));

      await act(async () => { await result.current.toggle(); });
      
      const lastCall = vi.mocked(fetch).mock.calls.at(-1)!;
      expect(lastCall[1]?.method).toBe("DELETE");
    });

    it("calls POST when status was 'not_watching'", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ watching: false }) } as any)
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as any);

      const { result } = renderHook(() => useWatchlist("AAPL", "p1"));
      await waitFor(() => expect(result.current.status).toBe("not_watching"));

      await act(async () => { await result.current.toggle(); });
      
      const lastCall = vi.mocked(fetch).mock.calls.at(-1)!;
      expect(lastCall[1]?.method).toBe("POST");
    });

    it("reverts status to 'watching' when DELETE fails", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ watching: true }) } as any)
        .mockResolvedValueOnce({ ok: false, json: async () => ({}) } as any);

      const { result } = renderHook(() => useWatchlist("AAPL", "p1"));
      await waitFor(() => expect(result.current.status).toBe("watching"));

      await act(async () => { await result.current.toggle(); });
      
      await waitFor(() => expect(result.current.status).toBe("watching"));
    });

    it("sets isToggling=true during request, false after", async () => {
      let resolveToggle: (v: any) => void;
      const togglePromise = new Promise((r) => (resolveToggle = r));

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ watching: false }) } as any)
        .mockReturnValueOnce(togglePromise as any);

      const { result } = renderHook(() => useWatchlist("AAPL", "p1"));
      await waitFor(() => expect(result.current.status).toBe("not_watching"));

      act(() => { result.current.toggle(); });
      expect(result.current.isToggling).toBe(true);

      await act(async () => {
        resolveToggle!({ ok: true, json: async () => ({}) });
        await togglePromise;
      });

      await waitFor(() => expect(result.current.isToggling).toBe(false));
    });
  });
});
