/**
 * LifeLogMonthGrid - Month view calendar grid
 * Shows a calendar with photo thumbnails for each day
 * 
 * Uses HTML table for guaranteed equal column widths
 */
import React, { useMemo } from 'react';
import { format, isSameMonth, isSameDay, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns';
import { Card, CardBody } from '@heroui/react';
import { motion } from 'framer-motion';
import LazyImage from '../common/LazyImage';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLifeLog } from './LifeLogContext';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function LifeLogMonthGrid() {
  const { 
    currentDate, 
    photosByDay, 
    setSelectedDay, 
    getPhotoUrl,
    coverPrefs,
    saveCoverPref
  } = useLifeLog();

  // Calculate calendar days properly - split into weeks
  const weeks = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 }); // Sunday
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    
    const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    
    // Split into weeks (7 days each)
    const result = [];
    for (let i = 0; i < days.length; i += 7) {
      result.push(days.slice(i, i + 7));
    }
    return result;
  }, [currentDate]);

  return (
    <Card className="bg-white dark:bg-zinc-900 shadow-none overflow-hidden border-none">
      <CardBody className="p-0">
        <table className="w-full border-collapse table-fixed">
          {/* Weekday Headers */}
          <thead>
            <tr className="bg-zinc-100/50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
              {WEEKDAYS.map((day, idx) => (
                <th 
                  key={day}
                  className={`
                    py-3 text-center text-xs font-semibold uppercase tracking-wide
                    ${idx === 0 || idx === 6 ? 'text-primary' : 'text-zinc-500 dark:text-zinc-400'}
                  `}
                  style={{ width: '14.2857%' }}
                >
                  {day}
                </th>
              ))}
            </tr>
          </thead>

          {/* Calendar Weeks */}
          <tbody>
            {weeks.map((week, weekIndex) => (
              <tr key={weekIndex} className="border-b border-zinc-200/50 dark:border-zinc-700/50 last:border-b-0">
                {week.map((day, dayIndex) => {
                  const dateKey = format(day, 'yyyy-MM-dd');
                  const dayPhotos = photosByDay.get(dateKey) || [];
                  const isCurrentMonth = isSameMonth(day, currentDate);
                  const hasPhotos = dayPhotos.length > 0;
                  const isToday = isSameDay(day, new Date());
                  
                  // Determine cover photo
                  const prefIndex = coverPrefs[dateKey] || 0;
                  const coverIndex = hasPhotos ? Math.abs(prefIndex % dayPhotos.length) : 0;
                  const cover = hasPhotos ? dayPhotos[coverIndex] : null;

                  return (
                    <td
                      key={day.toString()}
                      className={`
                        relative p-0 align-top
                        border-r border-zinc-200/50 dark:border-zinc-700/50 last:border-r-0
                        ${isCurrentMonth ? 'bg-white dark:bg-zinc-800' : 'bg-zinc-100/30 dark:bg-zinc-800/30'}
                        ${hasPhotos ? 'cursor-pointer hover:ring-2 hover:ring-primary hover:ring-inset' : ''}
                        transition-all duration-200 group
                      `}
                      onClick={() => hasPhotos && setSelectedDay(day)}
                    >
                      {/* 1:1 aspect ratio wrapper */}
                      <div className="relative w-full" style={{ paddingBottom: '100%' }}>
                        <div className="absolute inset-0">
                      {/* Day Number */}
                      <div className={`
                        absolute top-1.5 left-2 z-20
                        text-xs font-medium
                        ${!isCurrentMonth ? 'opacity-40' : ''}
                        ${cover ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]' : ''}
                        ${isToday ? 'bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center' : ''}
                        ${!isToday && !cover ? 'text-zinc-500 dark:text-zinc-400' : ''}
                      `}>
                        {format(day, 'd')}
                      </div>

                      {/* Photo Cover */}
                      {cover && isCurrentMonth && (
                        <div className="absolute inset-0 overflow-hidden">
                          <LazyImage
                            src={getPhotoUrl(cover)}
                            alt=""
                            className="w-full h-full"
                            objectFit="cover"
                          />
                          
                          {/* Gradient Overlay for text readability */}
                          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/20" />

                          {/* Photo Switcher (visible on hover) */}
                          {dayPhotos.length > 1 && (
                            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-1 py-1 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/60 to-transparent z-30">
                              <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  saveCoverPref(dateKey, prefIndex - 1);
                                }}
                                className="w-5 h-5 rounded-full bg-white/80 flex items-center justify-center text-black"
                              >
                                <ChevronLeft size={12} />
                              </motion.button>
                              <span className="text-white text-xs font-medium">
                                {dayPhotos.length}
                              </span>
                              <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  saveCoverPref(dateKey, prefIndex + 1);
                                }}
                                className="w-5 h-5 rounded-full bg-white/80 flex items-center justify-center text-black"
                              >
                                <ChevronRight size={12} />
                              </motion.button>
                            </div>
                          )}

                          {/* Single photo count badge */}
                          {dayPhotos.length === 1 && (
                            <div className="absolute bottom-1 right-1 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">
                              1
                            </div>
                          )}
                        </div>
                      )}

                      {/* Location info on hover */}
                      {cover && (cover.city_name || cover.country_name) && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity truncate z-20 pointer-events-none">
                          📍 {cover.city_name || cover.country_name}
                        </div>
                      )}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
