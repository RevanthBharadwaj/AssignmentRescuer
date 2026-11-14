import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { openDatabase } from './db/open';
import { Repository } from './db/repository';
import { AcademicService } from './core/service';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/noto-serif/300.css';
import './ui/styles.css';
import { errorMessage } from './ui/format';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { configurePdfWorker } from './core/input/pdf';

// PDF.js parses PDFs in a bundled worker; nothing is fetched from the network.
configurePdfWorker(pdfWorkerUrl);

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  try {
    const { driver, mode } = await openDatabase();
    const service = new AcademicService(new Repository(driver));
    await service.init();
    root.render(<StrictMode><App service={service} mode={mode} /></StrictMode>);
  } catch (e) {
    root.render(<p role="alert" style={{ padding: 24 }}>Could not open the local database: {errorMessage(e)}</p>);
  }
}

void boot();
