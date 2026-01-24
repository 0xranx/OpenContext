import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

// Custom Dialog Component (Alert/Confirm/Prompt)
export function CustomDialog({
  isOpen,
  onClose,
  onCancel,
  type = 'alert',
  title,
  message,
  placeholder,
  initialValue = '',
  onConfirm,
  confirmText,
  cancelText,
  isDestructive = false,
}) {
  const { t } = useTranslation();
  const finalConfirmText = confirmText || t('common.confirm');
  const finalCancelText = cancelText || t('common.cancel');
  const [inputValue, setInputValue] = useState(initialValue);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setInputValue(initialValue || '');
      if (type === 'prompt' || type === 'prompt_multiline') {
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    }
  }, [isOpen, initialValue, type]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e?.preventDefault();
    if ((type === 'prompt' || type === 'prompt_multiline') && !inputValue.trim()) return;
    if (typeof onConfirm === 'function') {
      onConfirm(type === 'prompt' || type === 'prompt_multiline' ? inputValue : undefined);
    }
    onClose();
  };

  const handleCancel = () => {
    if (typeof onCancel === 'function') {
      onCancel();
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-[2px] transition-opacity"
        onClick={handleCancel}
      />
      <div className="relative w-full max-w-[420px] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-150 scale-100">
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/30 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-2">
              {isDestructive && <ExclamationTriangleIcon className="h-4 w-4 text-red-500" />}
              {title}
            </h3>
            <div className="text-[10px] text-gray-400 font-mono bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
              ESC
            </div>
          </div>

          <div className="px-4 py-4">
            {message && <p className="text-sm text-gray-600 leading-relaxed mb-4">{message}</p>}

            {(type === 'prompt' || type === 'prompt_multiline') &&
              (type === 'prompt_multiline' ? (
                <textarea
                  ref={inputRef}
                  className="w-full min-h-[96px] px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 bg-white border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all resize-y shadow-sm"
                  placeholder={placeholder}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') handleCancel();
                  }}
                />
              ) : (
                <input
                  ref={inputRef}
                  type="text"
                  className="w-full px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 bg-white border border-gray-200 rounded-md focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all shadow-sm"
                  placeholder={placeholder}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') handleCancel();
                  }}
                />
              ))}
          </div>

          <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
            {type !== 'alert' && (
              <button
                type="button"
                onClick={handleCancel}
                className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors"
              >
              {finalCancelText}
            </button>
            )}
            <button
              type="submit"
              disabled={(type === 'prompt' || type === 'prompt_multiline') && !inputValue.trim()}
              className={`px-3 py-1.5 text-sm font-medium text-white rounded-md shadow-sm transition-all ${
                isDestructive ? 'bg-red-600 hover:bg-red-700' : 'bg-black hover:bg-gray-800'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {finalConfirmText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Context Menu Component
export function ContextMenu({ isOpen, x, y, onClose, items }) {
  if (!isOpen) return null;
  return (
    <div
      className="fixed z-[100] bg-white border border-gray-200 rounded-lg shadow-xl py-1 w-48 text-sm animate-in fade-in zoom-in-95 duration-100"
      style={{ top: y, left: x }}
    >
      <div className="fixed inset-0 z-[-1]" onClick={onClose} />
      {items.map((item, i) => (
        <button
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          className={`w-full text-left px-3 py-1.5 hover:bg-gray-100 flex items-center gap-2 ${
            item.className || 'text-gray-700'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            item.onClick();
            onClose();
          }}
        >
          {item.icon && <item.icon className="h-4 w-4 text-gray-400" />}
          {item.label}
        </button>
      ))}
    </div>
  );
}

