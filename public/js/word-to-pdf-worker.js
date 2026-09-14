/*
 * PDFdukan high-fidelity DOCX renderer.
 * ZetaJS is MIT licensed and drives ZetaOffice/LibreOffice in a Web Worker.
 * The selected document stays inside the browser's private virtual filesystem.
 */
import { ZetaHelperThread } from 'https://cdn.jsdelivr.net/npm/zetajs@1.2.0/source/zetaHelper.js';

const zHT = new ZetaHelperThread();
const zetajs = zHT.zetajs;
const css = zHT.css;

const hidden = new css.beans.PropertyValue({ Name: 'Hidden', Value: true });
const overwrite = new css.beans.PropertyValue({ Name: 'Overwrite', Value: true });
const pdfExport = new css.beans.PropertyValue({ Name: 'FilterName', Value: 'writer_pdf_Export' });
let model;

function getPageCount() {
  try {
    const viewCursor = model.getCurrentController().getViewCursor();
    const pageCursor = viewCursor.queryInterface(zetajs.type.interface(css.text.XPageCursor));
    pageCursor.jumpToLastPage();
    return Number(pageCursor.getPage()) || 0;
  } catch {
    return 0;
  }
}

function fitSmallOverflow(targetPages, forcedFitFactor) {
  let pages = getPageCount();
  let fitFactor = 1;
  if ((!targetPages || !pages || pages <= targetPages) && !forcedFitFactor) return { pages, fitFactor };

  try {
    const pageStyles = model.getStyleFamilies().getByName('PageStyles');
    const names = pageStyles.getElementNames();
    const originalHeights = new Map();

    for (const name of names) {
      const style = pageStyles.getByName(name);
      originalHeights.set(name, style.getPropertyValue('Height'));
    }

    if (forcedFitFactor > 1 && forcedFitFactor <= 1.08) {
      fitFactor = forcedFitFactor;
      for (const name of names) {
        const style = pageStyles.getByName(name);
        style.setPropertyValue('Height', Math.round(originalHeights.get(name) * fitFactor));
      }
      pages = getPageCount();
      return { pages, fitFactor };
    }

    // Writer/Word font metrics can push only a final line onto a new page.
    // Grow the temporary render canvas in tiny steps, capped at 8%; the main
    // thread scales the exported vector page back to the DOCX paper size.
    for (let step = 1; step <= 8 && pages > targetPages; step += 1) {
      fitFactor = 1 + step / 100;
      for (const name of names) {
        const style = pageStyles.getByName(name);
        style.setPropertyValue('Height', Math.round(originalHeights.get(name) * fitFactor));
      }
      pages = getPageCount();
    }
  } catch {
    fitFactor = 1;
  }

  return { pages, fitFactor };
}

zHT.thrPort.onmessage = event => {
  if (event.data.cmd !== 'convert') {
    zetajs.mainPort.postMessage({ cmd: 'error', message: 'Unknown conversion command.' });
    return;
  }

  const { from, to, name, targetPages, forcedFitFactor } = event.data;
  try {
    if (model && model.queryInterface(zetajs.type.interface(css.util.XCloseable))) {
      model.close(false);
    }

    model = zHT.desktop.loadComponentFromURL('file://' + from, '_blank', 0, [hidden]);
    if (!model) throw new Error('The DOCX could not be opened by the document engine.');

    const fit = fitSmallOverflow(Number(targetPages) || 0, Number(forcedFitFactor) || 0);
    model.storeToURL('file://' + to, [overwrite, pdfExport]);
    zetajs.mainPort.postMessage({
      cmd: 'converted',
      name,
      from,
      to,
      pages: fit.pages,
      fitFactor: fit.fitFactor,
    });
  } catch (error) {
    let message = error && error.message ? error.message : String(error || 'Conversion failed.');
    try {
      const unoError = zetajs.catchUnoException(error);
      if (unoError && unoError.Message) message = unoError.Message;
    } catch {}
    zetajs.mainPort.postMessage({ cmd: 'error', message });
  }
};

zHT.thrPort.postMessage({ cmd: 'start' });
