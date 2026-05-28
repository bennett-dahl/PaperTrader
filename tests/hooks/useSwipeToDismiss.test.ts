import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useSwipeToDismiss } from "@/hooks/useSwipeToDismiss";

function makeTouch(clientY: number): React.TouchEvent {
  return {
    touches: [{ clientY }],
  } as any;
}

describe("useSwipeToDismiss", () => {
  it("initializes with dragY=0", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSwipeToDismiss(onClose));
    expect(result.current.dragY).toBe(0);
  });

  it("sets dragY to delta when swiping down (positive delta)", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSwipeToDismiss(onClose));

    act(() => { result.current.onTouchStart(makeTouch(100)); });
    act(() => { result.current.onTouchMove(makeTouch(150)); });

    expect(result.current.dragY).toBe(50);
  });

  it("does not set negative dragY (upward swipe ignored)", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSwipeToDismiss(onClose));

    act(() => { result.current.onTouchStart(makeTouch(150)); });
    act(() => { result.current.onTouchMove(makeTouch(100)); }); // upward

    expect(result.current.dragY).toBe(0);
  });

  it("does nothing on touchMove when touchStart not called first", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSwipeToDismiss(onClose));

    act(() => { result.current.onTouchMove(makeTouch(200)); });
    expect(result.current.dragY).toBe(0);
  });

  it("calls onClose when dragY >= 120px on touchEnd", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSwipeToDismiss(onClose));

    act(() => { result.current.onTouchStart(makeTouch(0)); });
    act(() => { result.current.onTouchMove(makeTouch(130)); }); // 130px drag
    act(() => { result.current.onTouchEnd(); });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("springs back to 0 when dragY < 120px on touchEnd", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSwipeToDismiss(onClose));

    act(() => { result.current.onTouchStart(makeTouch(0)); });
    act(() => { result.current.onTouchMove(makeTouch(80)); }); // 80px drag
    act(() => { result.current.onTouchEnd(); });

    expect(result.current.dragY).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose exactly at threshold (120px)", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSwipeToDismiss(onClose));

    act(() => { result.current.onTouchStart(makeTouch(0)); });
    act(() => { result.current.onTouchMove(makeTouch(120)); }); // exactly 120px
    act(() => { result.current.onTouchEnd(); });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("resets dragY to 0 when NOT dismissing (spring back case)", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSwipeToDismiss(onClose));

    act(() => { result.current.onTouchStart(makeTouch(0)); });
    act(() => { result.current.onTouchMove(makeTouch(80)); }); // < 120px threshold
    act(() => { result.current.onTouchEnd(); });

    // Did not dismiss -> springs back to 0
    expect(result.current.dragY).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
  });
});
