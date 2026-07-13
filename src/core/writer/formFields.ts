// core/writer/formFields.ts
//
// 用 pdf-lib 的 form API 在导出的 PDF 中重建 AcroForm 字段。
// 与 Canva 式架构一致:表单字段是 overlay 数据,导出时在新 PDF 里
// 重新创建,不依赖原 PDF 的 AcroForm 结构。
//
// 代价:丢失原 PDF 表单的 JavaScript 脚本/formatting/自定义外观。
// 用户已确认接受(选择"重建 AcroForm"方案)。
import type { PDFDocument } from 'pdf-lib';
import type { FormFieldItem, PageMeta } from '../types';

/** Store y-down from top -> pdf-lib y-up from bottom. */
function pdfY(topY: number, height: number, pageHeight: number): number {
  return pageHeight - topY - height;
}

/**
 * 在 doc 中为每个 form-field overlay 创建对应的 AcroForm widget。
 */
export async function createFormFields(
  doc: PDFDocument,
  pages: PageMeta[],
  formFields: FormFieldItem[]
): Promise<void> {
  if (formFields.length === 0) return;
  const form = doc.getForm();

  for (const field of formFields) {
    const pageIndex = pages.findIndex((p) => p.id === field.pageId);
    if (pageIndex < 0) continue;
    const page = doc.getPage(pageIndex);
    const pageHeight = page.getHeight();
    const y = pdfY(field.bbox.y, field.bbox.h, pageHeight);

    try {
      if (field.kind === 'checkbox') {
        const cb = form.createCheckBox(safeFieldName(field.fieldName));
        if (field.value === true) cb.check();
        cb.addToPage(page, {
          x: field.bbox.x,
          y,
          width: field.bbox.w,
          height: field.bbox.h,
        });
      } else if (field.kind === 'radio') {
        // Radio groups: create one group per fieldName, add options.
        const groupName = safeFieldName(field.fieldName);
        let radio: ReturnType<typeof form.createRadioGroup>;
        try {
          radio = form.getRadioGroup(groupName);
        } catch {
          radio = form.createRadioGroup(groupName);
        }
        const optVal = String(field.value || '');
        if (optVal) {
          radio.addOptionToPage(optVal, page, {
            x: field.bbox.x,
            y,
            width: field.bbox.w,
            height: field.bbox.h,
          });
          radio.select(optVal);
        }
      } else if (field.kind === 'select') {
        const dd = form.createDropdown(safeFieldName(field.fieldName));
        if (field.options && field.options.length > 0) {
          dd.setOptions(field.options);
        }
        const v = String(field.value || '');
        if (v) dd.select(v);
        dd.addToPage(page, {
          x: field.bbox.x,
          y,
          width: field.bbox.w,
          height: field.bbox.h,
        });
      } else {
        // text / signature both go through createTextField.
        const tf = form.createTextField(safeFieldName(field.fieldName));
        tf.setText(String(field.value || ''));
        tf.addToPage(page, {
          x: field.bbox.x,
          y,
          width: field.bbox.w,
          height: field.bbox.h,
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[formFields] 创建字段 "${field.fieldName}" 失败,跳过:`,
        err
      );
    }
  }
}

/** 字段名不能为空,且需避免重复。 */
function safeFieldName(name: string): string {
  return name && name.trim() ? name : `field_${Math.random().toString(36).slice(2, 8)}`;
}
