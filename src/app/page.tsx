// app/page.tsx
"use client";

import { supabase, State, RAFFLE_ID, RAFFLE_ROOM_CHANNEL, generateUniqueUserId, getRandomColor, PresencePayload } from "@/lib/supabase";
import { RealtimeChannel } from "@supabase/supabase-js";
import React, { useEffect, useState, useRef } from "react";

export default function Home() {
  const [state, setState] = useState<State>(State.WAITING);
  const [winner, setWinner] = useState<string | null>(null);
  const [isFlashing, setIsFlashing] = useState<boolean>(false);
  // Generate a stable unique ID for this client session/tab
  const [userId] = useState(generateUniqueUserId());
  const flashIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // --- Flashing Effect ---
  useEffect(() => {
    if (state === State.DRAWING) {
      setIsFlashing(true);
      // Set initial color immediately
      document.body.style.backgroundColor = getRandomColor();
      // Start interval for subsequent flashes
      flashIntervalRef.current = setInterval(() => {
        document.body.style.backgroundColor = getRandomColor();
      }, 300); // Flash background color every 300ms
    } else {
      // Stop flashing if state changes or component unmounts
      setIsFlashing(false);
      if (flashIntervalRef.current) {
        clearInterval(flashIntervalRef.current);
        flashIntervalRef.current = null;
      }
      // Reset background color to default
      document.body.style.backgroundColor = '';
    }

    // Cleanup interval on component unmount or state change away from DRAWING
    return () => {
      if (flashIntervalRef.current) {
        clearInterval(flashIntervalRef.current);
      }
      // Ensure background is reset if component unmounts while flashing
      document.body.style.backgroundColor = '';
    };
  }, [state]); // Dependency array ensures this runs when 'state' changes

  // --- Supabase Realtime Setup ---
  useEffect(() => {
    console.log(`Client setup running for user: ${userId}`);
    let localChannel: RealtimeChannel; // Use local variable for setup

    const setupSubscription = async () => {
      // 1. Fetch initial state when component mounts
      try {
        console.log("Fetching initial state...");
        const { data, error } = await supabase
          .from("public_data")
          .select("state, winner")
          .eq("id", RAFFLE_ID)
          .single();

        if (error) throw error;
        if (!data) throw new Error("No data found for raffle ID.");

        console.log("Initial state fetched:", data);
        setState(data.state as State);
        setWinner(data.winner);

      } catch (fetchError: any) {
        console.error("Error fetching initial state:", fetchError?.message || fetchError);
        setState(State.ERROR); // Set error state
        return; // Stop setup if initial fetch fails
      }

      // 2. Create Supabase channel with presence configuration
      localChannel = supabase.channel(RAFFLE_ROOM_CHANNEL, {
        config: {
          presence: {
            key: userId, // Unique key for this client's presence
          },
        },
      });

      // Store channel reference for cleanup
      channelRef.current = localChannel;

      // 3. Subscribe to Database Changes in 'public_data' table
      localChannel.on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'public_data',
          filter: `id=eq.${RAFFLE_ID}` // Important: Only listen for changes to our raffle row
        },
        (payload) => {
          console.log('Client DB Change received!', payload);
          const newState = payload.new.state as State;
          const newWinner = payload.new.winner as string | null;
          // Update local state based on the received change
          setState(newState);
          setWinner(newWinner);
        }
      );

      // 4. Subscribe to Presence events (optional, mainly for debugging on client)
      localChannel.on('presence', { event: 'sync' }, () => {
        const presenceState = localChannel.presenceState();
        console.log('Client Presence sync:', presenceState);
      });
      localChannel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
        console.log('Client Presence join:', key, newPresences);
      });
      localChannel.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        console.log('Client Presence leave:', key, leftPresences);
      });


      // 5. Subscribe to the channel (connects listeners and presence)
      localChannel.subscribe(async (status) => {
        console.log(`Client Channel ${localChannel.topic} status:`, status);

        if (status === 'SUBSCRIBED') {
          // Once successfully subscribed, track this client's presence
          const payload: PresencePayload = {
            user: userId, // Include the user ID in the tracked payload
            online_at: new Date().toISOString()
          };
          const trackStatus = await localChannel.track(payload);
          console.log('Client Presence tracking status:', trackStatus);
        } else if (status === 'CLOSED') {
          // Handle channel closing unexpectedly if needed
          console.warn(`Client Channel ${localChannel.topic} closed.`);
        } else if (status.startsWith('CHANNEL_ERROR')) {
          console.error(`Client Channel ${localChannel.topic} error:`, status);
          setState(State.ERROR); // Set error state on channel error
        }
      });
    };

    setupSubscription();

    // --- Cleanup Function ---
    // This runs when the component unmounts
    return () => {
      console.log(`Client cleanup running for user: ${userId}`);
      if (channelRef.current) {
        const chan = channelRef.current;
        console.log(`Cleaning up channel: ${chan.topic}`);
        // Explicitly untrack presence
        chan.untrack()
          .then(() => console.log("Presence untracked."))
          .catch(err => console.error("Error untracking presence:", err));
        // Remove the channel subscription and listeners
        supabase.removeChannel(chan)
          .then(() => console.log("Channel removed."))
          .catch(err => console.error("Error removing channel:", err));
        channelRef.current = null;
      }
      // Ensure flashing stops if component unmounts quickly
      if (flashIntervalRef.current) {
        clearInterval(flashIntervalRef.current);
      }
      document.body.style.backgroundColor = ''; // Reset background on unmount
    };
  }, [userId]); // Effect depends on userId (stable)


  // --- Render UI ---
  return (
    <main style={{
      minHeight: '100vh', // Ensure background covers full height
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
      fontFamily: 'sans-serif', // Basic styling
      fontSize: 'clamp(1.5rem, 5vw, 2.5rem)', // Responsive font size
      fontWeight: 'bold',
      textAlign: 'center',
      transition: 'background-color 0.2s ease-in-out' // Smooth background transition
    }}>
      <h1>Raffle Status</h1>

      <p style={{ margin: '0.5rem 0' }}>State: <span style={{ color: state === State.ERROR ? 'red' : 'inherit' }}>{state}</span></p>

      {/* Display winner only when DRAWN */}
      {state === State.DRAWN && winner && (
        <p style={{ marginTop: '1rem', color: 'green', fontSize: '1.2em' }}>
          🎉 Winner: {winner} 🎉
        </p>
      )}

      {/* Informative text based on state */}
      {state === State.DRAWING && (
        <p style={{ marginTop: '1rem', fontStyle: 'italic', opacity: 0.8 }}>
          Drawing in progress... Good luck!
        </p>
      )}
      {state === State.WAITING && (
        <p style={{ marginTop: '1rem', fontStyle: 'italic', opacity: 0.8 }}>
          Waiting for the raffle to start...
        </p>
      )}
      {state === State.ERROR && (
        <p style={{ marginTop: '1rem', color: 'red', fontWeight: 'normal' }}>
          Connection error. Please refresh or check console.
        </p>
      )}
    </main>
  );
}