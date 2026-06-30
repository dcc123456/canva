// Coordinate helpers: convert between screen pixels and PDF points.
// PDF coordinates are in points (pt) with origin at the top-left of the page
// (we treat them as y-down, matching pdfjs's screen-space viewport).
import type { Rect } from '../core/types';

export interface Point {
  x: number;
  y: number;
}

export function screenToPdf(pt: Point, zoom: number): Point {
  return { x: pt.x / zoom, y: pt.y / zoom };
}

export function pdfToScreen(pt: Point, zoom: number): Point {
  return { x: pt.x * zoom, y: pt.y * zoom };
}

export function screenRectToPdf(rect: Rect, zoom: number): Rect {
  return {
    x: rect.x / zoom,
    y: rect.y / zoom,
    w: rect.w / zoom,
    h: rect.h / zoom,
  };
}

export function pdfRectToScreen(rect: Rect, zoom: number): Rect {
  return {
    x: rect.x * zoom,
    y: rect.y * zoom,
    w: rect.w * zoom,
    h: rect.h * zoom,
  };
}
