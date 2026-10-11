// Panneau « Algèbre » : liste des objets, curseurs, barre de saisie.
import { useMemo, useRef, useState } from 'react';
import type { Construction } from './engine/construction';
import { CommandRunner, COMMAND_HELP } from './engine/commands';
import { defToCommand, displayName, valueText } from './engine/describe';
import { Icon } from './icons';

interface Props {
  c: Construction;
  selected: string | null;
  onSelect: (id: string | null) => void;
  commit: () => void;
  /** Double-clic sur un nom de la liste : le renommer. */
  onRename?: (id: string) => void;
}

const TYPE_LABEL: Record<string, string> = {
  point: 'Points', line: 'Lignes', circle: 'Cercles', polygon: 'Polygones', function: 'Fonctions', number: 'Nombres & mesures',
};

export function Sidebar({ c, selected, onSelect, commit, onRename }: Props) {
  const runner = useMemo(() => new CommandRunner(c), [c]);
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [sugIndex, setSugIndex] = useState(0);
  const past = useRef<string[]>([]);
  const pastIdx = useRef(-1);

  const objects = c.objects.filter((o) => !o.aux);
  const groups = Object.keys(TYPE_LABEL)
    .map((t) => ({ t, items: objects.filter((o) => o.type === t) }))
    .filter((g) => g.items.length);

  // Autocomplétion sur le dernier mot tapé
  const word = input.match(/([\p{L}]+)$/u)?.[1] ?? '';
  const suggestions = word.length >= 2
    ? COMMAND_HELP.filter(([cmd]) => cmd.toLowerCase().startsWith(word.toLowerCase()) && /^[A-Z]/.test(cmd) && cmd.includes('(')).slice(0, 6)
    : [];

  const accept = (cmd: string) => {
    const name = cmd.split('(')[0];
    setInput(input.slice(0, input.length - word.length) + name + '(');
    setSugIndex(0);
  };

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    if (/^(aide|help|\?)$/i.test(text)) { setShowHelp(true); setInput(''); return; }
    commit();
    const lines = text.split(/\n/);
    let last = { ok: true, message: '' };
    for (const l of lines) { last = runner.run(l); if (!last.ok) break; }
    setFeedback({ ok: last.ok, text: last.message });
    if (last.ok) {
      past.current.unshift(text);
      pastIdx.current = -1;
      setInput('');
    }
  };

  return (
    <aside className="sidebar">
      <div className="panel-head">
        <span>Figure</span>
        <span className="count">{objects.length} objet{objects.length > 1 ? 's' : ''}</span>
      </div>

      <div className="objects">
        {!objects.length && (
          <div className="empty">
            <p>Ta figure est vide.</p>
            <p>Choisis un outil en haut, dessine à main levée, ou tape une commande ci-dessous.</p>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.t}>
            <h3>{TYPE_LABEL[g.t]}</h3>
            {g.items.map((o) => {
              const def = o.def;
              const dn = displayName(c, o);
              const undefinedObj = !c.comp(o.id);
              return (
                <div key={o.id} className={`obj ${selected === o.id ? 'sel' : ''} ${o.visible ? '' : 'hidden'} ${undefinedObj ? 'undef' : ''}`}
                  onClick={() => onSelect(selected === o.id ? null : o.id)}>
                  <button className="swatch" style={{ '--c': o.color } as React.CSSProperties} title={o.visible ? 'Masquer' : 'Afficher'}
                    onClick={(e) => { e.stopPropagation(); commit(); o.visible = !o.visible; c.changed(); }} />
                  <div className="obj-body">
                    <div className="obj-line">
                      <span className="obj-name" title="Double-clic pour renommer" onDoubleClick={(e) => { e.stopPropagation(); onRename?.(o.id); }}>{def.k === 'function' ? `${o.name}(x)` : dn}</span>
                      <span className="obj-val">{valueText(c, o)}</span>
                    </div>
                    {def.k === 'slider' ? (
                      <div className="slider-row" onClick={(e) => e.stopPropagation()}>
                        <span>{def.min}</span>
                        <input type="range" min={def.min} max={def.max} step={def.step} value={def.value}
                          onPointerDown={commit}
                          onChange={(e) => { def.value = Number(e.target.value); c.changed(); }} />
                        <span>{def.max}</span>
                      </div>
                    ) : (
                      <div className="obj-def">{def.k === 'function' ? '' : defToCommand(c, o)}</div>
                    )}
                  </div>
                  <button className="icon-btn ghost del" title="Supprimer"
                    onClick={(e) => { e.stopPropagation(); commit(); c.remove(o.id); c.changed(); if (selected === o.id) onSelect(null); }}>
                    <Icon name="close" size={15} />
                  </button>
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <div className="cmdbar">
        {suggestions.length > 0 && (
          <div className="suggest">
            {suggestions.map(([cmd, desc], i) => (
              <button key={cmd} className={i === sugIndex ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); accept(cmd); }}>
                <code>{cmd}</code><span>{desc}</span>
              </button>
            ))}
          </div>
        )}
        {feedback && feedback.text && <div className={`feedback ${feedback.ok ? 'ok' : 'err'}`}>{feedback.text}</div>}
        <div className="cmd-input">
          <span className="prompt">›</span>
          <input
            value={input}
            placeholder="Saisie : A=(2;3), Cercle(A;3), f(x)=2x+1…"
            spellCheck={false}
            onChange={(e) => { setInput(e.target.value); setFeedback(null); setSugIndex(0); }}
            onKeyDown={(e) => {
              if (suggestions.length && (e.key === 'Tab' || (e.key === 'Enter' && !input.includes('(')))) { e.preventDefault(); accept(suggestions[sugIndex][0]); return; }
              if (suggestions.length && e.key === 'ArrowDown') { e.preventDefault(); setSugIndex((sugIndex + 1) % suggestions.length); return; }
              if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
              if (e.key === 'ArrowUp' && past.current.length) {
                e.preventDefault();
                pastIdx.current = Math.min(past.current.length - 1, pastIdx.current + 1);
                setInput(past.current[pastIdx.current]);
              }
              if (e.key === 'Escape') setInput('');
            }}
          />
          <button className="icon-btn ghost" title="Aide des commandes" onClick={() => setShowHelp(!showHelp)}><Icon name="help" size={18} /></button>
        </div>
      </div>

      {showHelp && (
        <div className="help-pop">
          <div className="panel-head"><span>Commandes</span><button className="icon-btn ghost" onClick={() => setShowHelp(false)}><Icon name="close" size={16} /></button></div>
          <div className="help-list">
            <p className="muted">Sépare les arguments par « , » ou « ; » (avec « ; » tu peux écrire 2,5). Clique pour insérer.</p>
            {COMMAND_HELP.map(([cmd, desc]) => (
              <button key={cmd} onClick={() => { setInput(cmd); setShowHelp(false); }}>
                <code>{cmd}</code><span>{desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
