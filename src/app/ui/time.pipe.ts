import { Pipe, PipeTransform } from '@angular/core';

/** 83.456 -> "1:23.45" */
export function formatTime(t: number | null | undefined): string {
  if (t === null || t === undefined) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

@Pipe({ name: 'time' })
export class TimePipe implements PipeTransform {
  transform(t: number | null | undefined): string {
    return formatTime(t);
  }
}
