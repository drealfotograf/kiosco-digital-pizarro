import React, { useEffect, useState } from 'react';
import { api, on } from '../api.js';

const STATUS = { pending: 'En cola', printing: 'Imprimiendo…', retrying: 'Reintentando…', done: 'Listo', error: 'Error' };
const ICON = { pending: '⏳', printing: '🖨️', retrying: '🔄', done: '✅', error: '❌' };

export default function PrintQueue() {
  const [queue, setQueue] = useState([]);
  useEffect(() => {
    api('print:queue').then(setQueue).catch(() => {});
    return on('print:queue', setQueue);
  }, []);
  if (!queue.length) return null;
  const active = queue.filter((j) => j.status !== 'done');
  const done = queue.filter((j) => j.status === 'done').length;
  const total = queue.length;
  return (
    <div className="print-queue">
      <div className="pq-header">
        <span className="pq-title">Cola de impresión</span>
        <span className="pq-count">{done}/{total}</span>
      </div>
      <div className="pq-bar"><div className="pq-fill" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
      <div className="pq-list">
        {active.map((j) => (
          <div key={j.id} className={`pq-job ${j.status}`}>
            <span className="pq-icon">{ICON[j.status]}</span>
            <span className="pq-file">{j.file}</span>
            <span className="pq-status">{STATUS[j.status]}{j.attempt > 1 ? ` (${j.attempt})` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
