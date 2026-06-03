// Dashboard → PDF export. Captures the live #dash-body (canvas charts included)
// minus the Risk Asset Book, and downloads a paginated A4 PDF.

const _PDF_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];

function _loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

async function downloadDashboardPdf(btn) {
  const body = document.getElementById('dash-body');
  if (!body || !body.children.length) return;

  const label = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

  // Hide the Risk Asset Book(s) during capture, restore afterwards.
  const hidden = [...body.querySelectorAll('.dash-ra-card')];
  hidden.forEach(el => { el.dataset._pdfDisplay = el.style.display; el.style.display = 'none'; });

  try {
    for (const src of _PDF_LIBS) await _loadScriptOnce(src);

    const canvas = await html2canvas(body, {
      scale: 1.5,
      backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: body.scrollWidth,
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const imgW = pageW - margin * 2;
    const imgH = canvas.height * imgW / canvas.width;
    const contentH = pageH - margin * 2;

    const imgData = canvas.toDataURL('image/jpeg', 0.82);
    let heightLeft = imgH;
    pdf.addImage(imgData, 'JPEG', margin, margin, imgW, imgH, 'dash', 'FAST');
    heightLeft -= contentH;
    while (heightLeft > 0) {
      const position = margin - (imgH - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', margin, position, imgW, imgH, 'dash', 'FAST');
      heightLeft -= contentH;
    }

    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    pdf.save(`DailyWealth-Dashboard-${stamp}.pdf`);
  } catch (e) {
    alert('Could not generate PDF: ' + e.message);
  } finally {
    hidden.forEach(el => { el.style.display = el.dataset._pdfDisplay || ''; delete el.dataset._pdfDisplay; });
    if (btn) { btn.disabled = false; btn.innerHTML = label; }
  }
}
