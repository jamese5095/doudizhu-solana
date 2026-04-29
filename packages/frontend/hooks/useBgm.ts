'use client';

import { useEffect, useRef, useCallback } from 'react';
import { GamePhase } from '@doudizhu/types';

const BASE_VOLUME = 0.45;

/**
 * 对局开始（phase 进入 Bidding 或 Playing）时自动播放背景音乐，
 * 对局结束（Ended）或离开页面时停止。支持外部静音控制。
 */
export function useBgm(phase: GamePhase) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mutedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!audioRef.current) {
      const audio = new Audio('/room-bgm.mp3');
      audio.loop = true;
      audio.volume = BASE_VOLUME;
      audioRef.current = audio;
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (phase === GamePhase.Bidding || phase === GamePhase.Playing) {
      audio.loop = true;
      audio.volume = mutedRef.current ? 0 : BASE_VOLUME;
      if (audio.paused) {
        audio.play().catch(() => {});
      }
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [phase]);

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : BASE_VOLUME;
    }
  }, []);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  return { setMuted };
}
