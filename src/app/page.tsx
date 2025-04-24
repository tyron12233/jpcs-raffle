"use client";

import { supabase, State, RAFFLE_ID, RAFFLE_ROOM_CHANNEL, generateUniqueUserId, getRandomColor, PresencePayload } from "@/lib/supabase";
import { RealtimeChannel } from "@supabase/supabase-js";
import React, { useEffect, useState, useRef } from "react";

export default function Home() {
  const [state, setState] = useState<State>(State.WAITING);
  const [winner, setWinner] = useState<string | null>(null);
  const [isFlashing, setIsFlashing] = useState<boolean>(false);
  const [userId] = useState(generateUniqueUserId());
  const [backgroundColor, setBackgroundColor] = useState('#121212');
  const flashIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isCurrentUserWinner = state === State.DRAWN && winner !== null && userId === winner;

  useEffect(() => {
    const setFinalBackground = (isWinner: boolean | null) => {
      if (isWinner === true) {
        setBackgroundColor('#1DB954');
      } else if (isWinner === false) {
        setBackgroundColor('#e91429');
      } else {
        setBackgroundColor('#181818');
      }
    };

    if (state === State.DRAWING) {
      setIsFlashing(true);
      setBackgroundColor(getRandomColor());
      flashIntervalRef.current = setInterval(() => {
        setBackgroundColor(getRandomColor());
      }, 300);
    } else if (state === State.DRAWN && winner !== null) {
      setIsFlashing(false);
      if (flashIntervalRef.current) clearInterval(flashIntervalRef.current);
      setFinalBackground(userId === winner);
    } else {
      setIsFlashing(false);
      if (flashIntervalRef.current) clearInterval(flashIntervalRef.current);
      setFinalBackground(null);
    }

    return () => {
      if (flashIntervalRef.current) clearInterval(flashIntervalRef.current);
      setBackgroundColor('#181818');
    };
  }, [state, winner, userId]);

  useEffect(() => {
    const setupSubscription = async () => {
      try {
        const { data } = await supabase
          .from("public_data")
          .select("state, winner")
          .eq("id", RAFFLE_ID)
          .single();

        setState(data?.state as State);
        setWinner(data?.winner);
      } catch (error) {
        setState(State.ERROR);
      }

      const localChannel = supabase.channel(RAFFLE_ROOM_CHANNEL, {
        config: { presence: { key: userId } },
      });

      channelRef.current = localChannel;

      localChannel.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'public_data', filter: `id=eq.${RAFFLE_ID}` },
        (payload) => {
          setState(payload.new.state as State);
          setWinner(payload.new.winner as string | null);
        }
      );

      localChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await localChannel.track({ user: userId, online_at: new Date().toISOString() });
        }
      });
    };

    setupSubscription();

    return () => {
      if (channelRef.current) {
        channelRef.current.untrack();
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [userId]);

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: backgroundColor,
      transition: 'background-color 0.3s ease',
      padding: '2rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#ffffff',
      textAlign: 'center'
    }}>
      <h1 style={{
        fontSize: '2.5rem',
        fontWeight: '700',
        letterSpacing: '-0.04em',
        marginBottom: '2rem',
        background: 'linear-gradient(45deg, #1DB954, #ffffff)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent'
      }}>
        JPCS Raffle
      </h1>

      {state === State.DRAWING && (
        <div style={{
          padding: '1.5rem 2.5rem',
          background: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '12px',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)'
        }}>
          <p style={{ fontSize: '1.5rem', margin: 0 }}>Shuffling participants...</p>
          <p style={{ opacity: 0.8, margin: '0.5rem 0 0' }}>Good luck! 🎵</p>
        </div>
      )}

      {state === State.DRAWN && winner !== null && (
        <div style={{
          padding: '2rem 3rem',
          background: isCurrentUserWinner
            ? 'linear-gradient(135deg, #1DB954, #178B42)'
            : 'linear-gradient(135deg, #e91429, #8B0000)',
          borderRadius: '16px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
          transform: 'scale(1.05)',
          transition: 'transform 0.3s ease'
        }}>
          <p style={{
            fontSize: '2rem',
            margin: 0,
            fontWeight: '700',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            {isCurrentUserWinner ? (
              <>
                🎉 You Won! 🎉
              </>
            ) : (
              <>
                🎊 Winner Selected 🎊
              </>
            )}
          </p>
          {!isCurrentUserWinner && (
            <p style={{ opacity: 0.9, margin: '1rem 0 0' }}>
              Congratulations to our lucky winner!
            </p>
          )}
        </div>
      )}

      {state === State.WAITING && (
        <div style={{
          padding: '1rem 2rem',
          background: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          marginTop: '1rem'
        }}>
          <p style={{ margin: 0 }}>Waiting for the raffle to begin...</p>
        </div>
      )}

      {state === State.ERROR && (
        <div style={{
          padding: '1rem 2rem',
          background: 'rgba(235, 0, 0, 0.2)',
          borderRadius: '8px',
          marginTop: '1rem'
        }}>
          <p style={{ margin: 0 }}>⚠️ Connection error - Please refresh</p>
        </div>
      )}
    </main>
  );
}