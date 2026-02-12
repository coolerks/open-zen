import React, { useEffect, useMemo, useRef, useState } from 'react';

interface SelectOption {
  value: string | number;
  label: string;
  meta?: React.ReactNode;
  searchText?: string;
}

interface SelectProps {
  label?: string;
  options: SelectOption[];
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
}

export const Select: React.FC<SelectProps> = ({
  label,
  options,
  value,
  onChange,
  placeholder = '请选择',
  className = '',
  disabled = false,
  searchable = false,
  searchPlaceholder = '搜索...',
}) => {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const normalizedValue = String(value ?? '');
  const selectedOption = useMemo(
    () => options.find((option) => String(option.value) === normalizedValue) ?? null,
    [options, normalizedValue],
  );

  const filteredOptions = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed) {
      return options;
    }
    return options.filter((option) => {
      const labelText = option.label.toLowerCase();
      const valueText = String(option.value).toLowerCase();
      const searchText = option.searchText?.toLowerCase() ?? '';
      return labelText.includes(trimmed) || valueText.includes(trimmed) || searchText.includes(trimmed);
    });
  }, [options, keyword]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !searchable) {
      return;
    }
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, searchable]);

  const toggleOpen = () => {
    if (disabled) {
      return;
    }
    setOpen((prev) => {
      const next = !prev;
      if (!next) {
        setKeyword('');
      }
      return next;
    });
  };

  return (
    <div ref={containerRef} className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}
      <div className={`relative ${className}`}>
        <button
          type="button"
          onClick={toggleOpen}
          disabled={disabled}
          className={`flex w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm
            focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
            dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100
            disabled:cursor-not-allowed disabled:opacity-50`}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={`truncate ${selectedOption ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>
            {selectedOption?.label ?? placeholder}
          </span>
          <svg
            className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open && (
          <div
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-md border border-[rgb(209,209,209)] bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
            role="listbox"
          >
            {searchable && (
              <div className="border-b border-[rgb(209,209,209)] p-2 dark:border-gray-700">
                <input
                  ref={searchInputRef}
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  className="h-8 w-full rounded-md border border-[rgb(209,209,209)] bg-white px-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  placeholder={searchPlaceholder}
                />
              </div>
            )}

            <div className="max-h-64 overflow-y-auto py-1">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((option) => {
                  const active = String(option.value) === normalizedValue;
                  return (
                    <button
                      key={String(option.value)}
                      type="button"
                      onClick={() => {
                        onChange(String(option.value));
                        setKeyword('');
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                        active
                          ? 'bg-[rgb(245,245,245)] text-[#0d0d0d] dark:bg-blue-900/30 dark:text-blue-300'
                          : 'text-gray-700 hover:bg-[rgb(245,245,245)] dark:text-gray-200 dark:hover:bg-gray-700'
                      }`}
                      role="option"
                      aria-selected={active}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      <div className="ml-auto flex shrink-0 items-center gap-2">
                        {option.meta && (
                          <span className={`text-[11px] ${active ? 'text-[#0d0d0d] dark:text-blue-300' : 'text-gray-500 dark:text-gray-400'}`}>
                            {option.meta}
                          </span>
                        )}
                        {active && (
                          <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M4.5 10.5L8 14L15.5 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })
              ) : (
                <p className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500">未找到匹配项</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
