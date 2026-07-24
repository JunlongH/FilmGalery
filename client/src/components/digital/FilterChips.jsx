import React from 'react';
import { Film, Camera, Layers } from 'lucide-react';

const OPTIONS = [
  { value: 'all', label: 'All', icon: Layers },
  { value: 'film', label: 'Film', icon: Film },
  { value: 'digital', label: 'Digital', icon: Camera },
];

export default function FilterChips({ value = 'all', onChange, counts, className = '' }) {
  return (
    <div className={`inline-flex items-center gap-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 p-0.5 ${className}`}>
      {OPTIONS.map(({ value: optVal, label, icon: Icon }) => {
        const active = value === optVal;
        const count = counts?.[optVal];
        return (
          <button
            key={optVal}
            onClick={() => onChange(optVal)}
            className={`
              inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
              transition-all duration-150
              ${active
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
              }
            `}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {count != null && (
              <span className={`text-xs ml-0.5 ${active ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-400 dark:text-zinc-500'}`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
