// features/forms/detectFormFields.ts
import { ensureEngine } from '../../core/engine';
import type { FormField } from '../../core/engine';

export interface DetectFormFieldsOptions {
  pdfBytes: Uint8Array;
  onProgress?: (progress: number, label?: string) => void;
}

export async function detectFormFields(
  options: DetectFormFieldsOptions
): Promise<FormField[]> {
  const engine = await ensureEngine('edit', {
    onProgress: options.onProgress,
  });
  if (!engine) {
    throw new Error('PDF 引擎不可用');
  }
  return engine.parseFormFields({ pdfBytes: options.pdfBytes });
}
