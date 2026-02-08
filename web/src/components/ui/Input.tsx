import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, className = '', ...props }) => {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}
      <input
        className={`rounded-md border border-gray-300 bg-white px-3 py-2 text-sm
          focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
          dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100
          disabled:bg-gray-100 disabled:cursor-not-allowed
          dark:disabled:bg-gray-900 ${className}`}
        {...props}
      />
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
};

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export const Textarea: React.FC<TextareaProps> = ({ label, className = '', ...props }) => {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}
      <textarea
        className={`rounded-md border border-gray-300 bg-white px-3 py-2 text-sm
          focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
          dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100
          resize-none ${className}`}
        {...props}
      />
    </div>
  );
};
