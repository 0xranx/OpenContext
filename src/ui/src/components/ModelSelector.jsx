import { useState, useRef, useEffect } from 'react';
import { ChevronDownIcon, CheckIcon } from '@heroicons/react/24/outline';

export function ModelSelector({ value, options, onChange, disabled, placeholder, className }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);
  const label = selectedOption ? selectedOption.label : (value || placeholder || 'Select Model');
  const hasValue = Boolean(selectedOption || value);

  return (
    <div className={`relative ${className || ''}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          group flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all duration-200 max-w-full
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800'}
          ${isOpen 
            ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100' 
            : hasValue 
              ? 'text-zinc-700 dark:text-zinc-300' 
              : 'text-zinc-500 dark:text-zinc-400'}
        `}
        title="Select Model"
      >
        <span className="truncate block flex-1 text-left min-w-0">{label}</span>
        <ChevronDownIcon 
          className={`h-3 w-3 text-zinc-400 transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} 
        />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 w-64 max-h-60 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900 z-50 animate-in fade-in zoom-in-95 duration-100 origin-bottom-left">
          <div className="p-1 space-y-0.5">
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`
                    w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs text-left transition-colors
                    ${isSelected 
                      ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 font-medium' 
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-200'}
                  `}
                >
                  <span className="truncate">{option.label}</span>
                  {isSelected && <CheckIcon className="h-3 w-3 ml-2 flex-shrink-0" />}
                </button>
              );
            })}
            {options.length === 0 && (
              <div className="px-2 py-2 text-xs text-zinc-400 text-center italic">
                No models available
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
