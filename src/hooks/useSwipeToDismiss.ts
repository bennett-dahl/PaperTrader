"use client";

import { useState, useRef } from "react";

const DISMISS_THRESHOLD = 120; // px

export interface UseSwipeToDismissReturn {
  dragY: number;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
}

export function useSwipeToDismiss(
  onClose: () => void
): UseSwipeToDismissReturn {
  const [dragY, setDragY] = useState(0);
  const startYRef = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (startYRef.current === null) return;
    const delta = e.touches[0].clientY - startYRef.current;
    if (delta > 0) {
      setDragY(delta);
    }
  };

  const onTouchEnd = () => {
    if (dragY >= DISMISS_THRESHOLD) {
      onClose();
    } else {
      setDragY(0);
    }
    startYRef.current = null;
  };

  return { dragY, onTouchStart, onTouchMove, onTouchEnd };
}
