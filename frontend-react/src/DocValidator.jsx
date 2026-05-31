import { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, AlertTriangle, X, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from './api';

const EXT_ICONS = {
  '.md': '📝', '.txt': '📄', '.csv': '📊', '.json': '🔵',
  '.env': '🔐', '.py': '🐍', '.js': '🟡', '.jsx': '⚛',
};

function LineRow({ line, index }) {
  const [open, setOpen] = useState(false);
  const hasIssues = line.errors.length || line.warnings.length;
  if (!hasIssues) return null;

  const color = line.errors.length ? 'var(--danger)' : 'var(--warn)';
  const bg    = line.errors.length ? 'var(--danger)08' : 'var(--warn)08';

  return (
    <div style={{ borderBottom: '1px solid var(--border)', background: open ? bg : 'transparent' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', cursor: 'pointer' }}
      >
        {open ? <ChevronDown size={12} style={{ color }} /> : <ChevronRight size={12} style={{ color }} />}
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', width: 40 }}>
          L{line.line_number}
        </span>
        {line.errors.length > 0
          ? <AlertCircle size={12} style={{ color: 'var(--danger)', flexShrink: 0 }} />
          : <AlertTriangle size={12} style={{ color: 'var(--warn)', flexShrink: 0 }} />
        }
        <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, fontFamily: 'var(--mono)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {line.content || <em style={{ color: 'var(--text3)' }}>(empty)</em>}
        </span>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {line.errors.length > 0 && (
            <span className="badge badge-red">{line.errors.length} err</span>
          )}
          {line.warnings.length > 0 && (
            <span className="badge badge-yellow">{line.warnings.length} warn</span>
          )}
        </div>
      </div>
      {open && (
        <div style={{ padding: '0 12px 10px 54px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {line.errors.map((e, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--danger)', display: 'flex', gap: 6 }}>
              <span>✗</span><span>{e}</span>
            </div>
          ))}
          {line.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--warn)', display: 'flex', gap: 6 }}>
              <span>⚠</span><span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DocValidator({ toast }) {
  const [dragging, setDragging] = useState(false);
  const [validating, setValidating] = useState(false);
  const [report, setReport] = useState(null);
  const [textMode, setTextMode] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [textFilename, setTextFilename] = useState('document.txt');
  const fileRef = useRef();

  async function handleFile(file) {
    setValidating(true);
    setReport(null);
    try {
      const result = await api.validate.file(file);
      setReport(result);
    } catch (e) { toast(e.message, 'error'); }
    setValidating(false);
  }

  async function handleText() {
    if (!textInput.trim()) return;
    setValidating(true);
    setReport(null);
    try {
      const result = await api.validate.text(textFilename, textInput);
      setReport(result);
    } catch (e) { toast(e.message, 'error'); }
    setValidating(false);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  const issueLines = report?.line_results || [];
  const ext = report ? EXT_ICONS[report.file_type] || '📄' : null;

  return (
    <div style={{ padding: 24, maxWidth: 860, display: 'flex', flexDirection: 'column', gap: 20, height: '100%', overflowY: 'auto' }}>
      <div>
        <h2 style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 700 }}>Document Validator</h2>
        <p className="text-muted text-sm">Upload a file or paste text — each line is validated for errors, security issues, and format rules</p>
      </div>

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className={`btn btn-sm ${!textMode ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTextMode(false)}>
          <Upload size={12} /> Upload File
        </button>
        <button className={`btn btn-sm ${textMode ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTextMode(true)}>
          <FileText size={12} /> Paste Text
        </button>
      </div>

      {/* Upload zone */}
      {!textMode && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border2)'}`,
            borderRadius: 12, padding: '40px 24px', textAlign: 'center', cursor: 'pointer',
            background: dragging ? 'var(--accent)08' : 'var(--surface)',
            transition: 'all 0.15s',
          }}
        >
          <Upload size={28} style={{ color: 'var(--text3)', marginBottom: 12 }} />
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Drop a file or click to browse</div>
          <div className="text-sm text-muted">.txt .md .csv .json .env .py .js .jsx</div>
          <input ref={fileRef} type="file" style={{ display: 'none' }}
            accept=".txt,.md,.csv,.json,.env,.py,.js,.jsx,.ts,.tsx"
            onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
        </div>
      )}

      {/* Text paste mode */}
      {textMode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>Filename (used to detect format rules)</label>
              <input value={textFilename} onChange={e => setTextFilename(e.target.value)}
                placeholder="e.g. config.json, notes.md, data.csv" />
            </div>
            <button className="btn btn-primary" onClick={handleText} disabled={validating || !textInput.trim()}>
              {validating ? <><span className="spinner" /> Validating…</> : 'Validate'}
            </button>
          </div>
          <textarea
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
            placeholder="Paste your document content here…"
            style={{ minHeight: 200, fontFamily: 'var(--mono)', fontSize: 12 }}
          />
        </div>
      )}

      {validating && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text2)' }}>
          <div className="spinner" /> Validating line by line…
        </div>
      )}

      {/* Report */}
      {report && (
        <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Summary card */}
          <div className="card" style={{
            padding: '16px 20px',
            borderColor: report.is_valid ? 'var(--accent3)40' : 'var(--danger)40',
            background: report.is_valid ? 'var(--accent3)06' : 'var(--danger)06',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {report.is_valid
                ? <CheckCircle size={22} style={{ color: 'var(--accent3)', flexShrink: 0 }} />
                : <AlertCircle size={22} style={{ color: 'var(--danger)', flexShrink: 0 }} />
              }
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 15,
                  color: report.is_valid ? 'var(--accent3)' : 'var(--danger)' }}>
                  {ext} {report.filename}
                </div>
                <div className="text-sm text-muted" style={{ marginTop: 2 }}>{report.summary}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>{report.total_lines}</div>
                  <div className="text-xs text-muted">lines</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 18, color: 'var(--danger)' }}>{report.error_lines}</div>
                  <div className="text-xs text-muted">errors</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 18, color: 'var(--warn)' }}>{report.warning_lines}</div>
                  <div className="text-xs text-muted">warnings</div>
                </div>
              </div>
            </div>
          </div>

          {/* Global errors/warnings */}
          {(report.global_errors.length > 0 || report.global_warnings.length > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {report.global_errors.map((e, i) => (
                <div key={i} style={{ padding: '8px 12px', background: 'var(--danger)10',
                  border: '1px solid var(--danger)30', borderRadius: 6, fontSize: 12, color: 'var(--danger)',
                  display: 'flex', gap: 8 }}>
                  <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {e}
                </div>
              ))}
              {report.global_warnings.map((w, i) => (
                <div key={i} style={{ padding: '8px 12px', background: 'var(--warn)10',
                  border: '1px solid var(--warn)30', borderRadius: 6, fontSize: 12, color: 'var(--warn)',
                  display: 'flex', gap: 8 }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {w}
                </div>
              ))}
            </div>
          )}

          {/* Line-by-line results */}
          {issueLines.length > 0 && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)',
                fontSize: 11, color: 'var(--text2)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Lines with issues ({issueLines.length})
              </div>
              <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                {issueLines.map((line, i) => <LineRow key={i} line={line} index={i} />)}
              </div>
            </div>
          )}

          {report.is_valid && issueLines.length === 0 && (
            <div style={{ textAlign: 'center', padding: '24px', color: 'var(--accent3)', fontSize: 13 }}>
              <CheckCircle size={32} style={{ marginBottom: 8 }} />
              <div style={{ fontWeight: 600 }}>All {report.total_lines} lines passed validation</div>
              {report.global_warnings.length === 0 && <div className="text-muted text-sm">No issues found.</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
