// app/admin/page.tsx
"use client";

import {
    supabase,
    State,
    PublicData,
    RAFFLE_ID,
    RAFFLE_ROOM_CHANNEL,
    pickRandomElement,
    // Import specific types needed
    PresencePayload,
    PresenceStateForUser
} from "@/lib/supabase";
import { RealtimeChannel, RealtimePresenceState } from "@supabase/supabase-js";
import React, { useEffect, useState, useRef, useCallback } from "react";

export default function AdminPage() {
    // State for the raffle data itself (state, winner)
    const [raffleData, setRaffleData] = useState<PublicData | null>(null);
    // State to hold the raw presence information from Supabase
    const [connectedUsers, setConnectedUsers] = useState<RealtimePresenceState>({});
    // Loading state for async operations
    const [isLoading, setIsLoading] = useState<boolean>(false);
    // Error message state
    const [error, setError] = useState<string | null>(null);
    // Ref to hold the Supabase channel instance
    const channelRef = useRef<RealtimeChannel | null>(null);

    // Derived state for easier access in UI and logic
    const currentState = raffleData?.state ?? State.WAITING;
    const currentWinner = raffleData?.winner;

    // --- Derive the list of user IDs from the raw presence state ---
    const userList = Object.values(connectedUsers) // Get arrays of presence states: PresenceStateForUser[][]
        .flat() // Flatten into a single array: PresenceStateForUser[]
        .map((presenceEntry) => {
            // Cast each entry to our specific type to access the 'user' property
            return (presenceEntry as PresenceStateForUser).user;
        });

    // --- Fetch initial data and setup subscriptions ---
    const setupAdminSubscription = useCallback(async () => {
        console.log("Admin setup running...");
        setError(null); // Clear previous errors on setup
        setIsLoading(true); // Indicate loading during initial fetch

        // 1. Fetch initial raffle state
        try {
            console.log("Admin fetching initial state...");
            const { data, error: fetchError } = await supabase
                .from("public_data")
                .select("*") // Fetch all columns for the admin view
                .eq("id", RAFFLE_ID)
                .single(); // Expect only one row for the raffle ID

            if (fetchError) throw fetchError;
            if (!data) throw new Error(`No raffle data found for ID ${RAFFLE_ID}.`);

            console.log("Admin initial state fetched:", data);
            setRaffleData(data as PublicData);

        } catch (err: any) {
            console.error("Admin: Error fetching initial state:", err?.message || err);
            setError(`Failed to fetch initial state: ${err?.message || 'Unknown error'}`);
            // Set a default error state if fetch fails
            setRaffleData({ id: RAFFLE_ID, created_at: new Date().toISOString(), state: State.ERROR, winner: null });
            setIsLoading(false); // Stop loading indicator
            return; // Stop setup if initial fetch fails
        } finally {
            // Ensure loading is false even if fetch succeeded quickly
            // Delay slightly to avoid flicker if fetch is instant
            setTimeout(() => setIsLoading(false), 100);
        }


        // 2. Create Supabase channel (Admin does NOT track its own presence)
        const adminChannel = supabase.channel(RAFFLE_ROOM_CHANNEL);
        channelRef.current = adminChannel; // Store reference for cleanup

        // 3. Subscribe to Database Changes for the specific raffle row
        adminChannel.on(
            'postgres_changes',
            {
                event: '*', // Listen for INSERT/UPDATE/DELETE
                schema: 'public',
                table: 'public_data',
                filter: `id=eq.${RAFFLE_ID}`
            },
            (payload) => {
                console.log('Admin: DB Change received!', payload);
                setError(null); // Clear error on successful update
                if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
                    // Update admin state with the latest data
                    setRaffleData(payload.new as PublicData);
                } else if (payload.eventType === 'DELETE') {
                    // Handle deletion if necessary, e.g., show an error or reset
                    setError(`Raffle data (ID: ${RAFFLE_ID}) was deleted.`);
                    setRaffleData({ id: RAFFLE_ID, created_at: new Date().toISOString(), state: State.ERROR, winner: null });
                }
            }
        );

        // 4. Subscribe to Presence events to track connected clients
        adminChannel.on('presence', { event: 'sync' }, () => {
            // 'sync' gives the complete current presence state
            const presenceState = adminChannel.presenceState();
            console.log('Admin: Presence sync received:', presenceState);
            setConnectedUsers(presenceState); // Update state with the latest presence info
        });

        // Optional: Listen to join/leave for immediate feedback (sync covers it eventually)
        // adminChannel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
        //   console.log('Admin: Presence join:', key, newPresences);
        // });
        // adminChannel.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        //   console.log('Admin: Presence leave:', key, leftPresences);
        // });

        // 5. Subscribe to the channel to activate listeners
        adminChannel.subscribe((status) => {
            console.log(`Admin Channel ${adminChannel.topic} status:`, status);
            if (status.startsWith('CHANNEL_ERROR')) {
                const errorMsg = `Channel Error: ${status}. Realtime updates might be interrupted.`;
                console.error(errorMsg);
                setError(errorMsg); // Show persistent error on channel failure
            } else if (status === 'SUBSCRIBED') {
                setError(null); // Clear errors on successful connection/reconnection
            } else if (status === 'CLOSED') {
                console.warn(`Admin Channel ${adminChannel.topic} closed.`);
                // Optionally attempt to resubscribe or show a warning
            }
        });

    }, []); // Empty dependency array means this runs once on mount

    // --- Run setup effect ---
    useEffect(() => {
        setupAdminSubscription();

        // --- Cleanup Function ---
        return () => {
            console.log("Admin cleanup running...");
            if (channelRef.current) {
                const chan = channelRef.current;
                console.log(`Admin: Cleaning up channel: ${chan.topic}`);
                // Unsubscribe and remove listeners
                supabase.removeChannel(chan)
                    .then(() => console.log("Admin: Channel removed."))
                    .catch(err => console.error("Admin: Error removing channel:", err));
                channelRef.current = null;
            }
        };
    }, [setupAdminSubscription]); // Depend on the setup function itself

    // --- Admin Action Handlers ---

    const handleStartDraw = async () => {
        if (isLoading || currentState !== State.WAITING) return;
        setIsLoading(true);
        setError(null);
        console.log("Admin: Starting draw...");

        try {
            const { error: updateError } = await supabase
                .from("public_data")
                .update({
                    state: State.DRAWING,
                    winner: null // Ensure winner is cleared when starting
                })
                .eq("id", RAFFLE_ID) // Target the specific raffle row
                .select() // Optional: select to confirm update
                .single(); // Expect one row updated

            if (updateError) throw updateError;
            // State update will be reflected via the realtime subscription
            console.log("Admin: Draw started successfully via DB update.");

        } catch (err: any) {
            const errorMsg = `Failed to start draw: ${err?.message || 'Unknown error'}`;
            console.error("Admin Error starting draw:", errorMsg);
            setError(errorMsg);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePickWinner = async () => {
        if (isLoading || currentState !== State.DRAWING || userList.length === 0) return;
        setIsLoading(true);
        setError(null);
        console.log("Admin: Picking winner...");

        // Select a random user ID from the derived list
        const winnerId = pickRandomElement(userList);

        if (!winnerId) {
            setError("No users connected to pick a winner from.");
            setIsLoading(false);
            console.warn("Admin: Attempted to pick winner with no users.");
            return;
        }

        console.log(`Admin: Selected winner ID: ${winnerId}`);

        try {
            const { error: updateError } = await supabase
                .from("public_data")
                .update({
                    state: State.DRAWN,
                    winner: winnerId // Set the chosen winner ID
                })
                .eq("id", RAFFLE_ID)
                .select() // Optional: confirm update
                .single(); // Expect one row updated

            if (updateError) throw updateError;
            // State update will be reflected via the realtime subscription
            console.log("Admin: Winner picked successfully via DB update.");

        } catch (err: any) {
            const errorMsg = `Failed to pick winner: ${err?.message || 'Unknown error'}`;
            console.error("Admin Error picking winner:", errorMsg);
            setError(errorMsg);
        } finally {
            setIsLoading(false);
        }
    };

    const handleResetRaffle = async () => {
        // Allow reset from any state except while already loading
        if (isLoading) return;
        setIsLoading(true);
        setError(null);
        console.log("Admin: Resetting raffle...");

        try {
            const { error: updateError } = await supabase
                .from("public_data")
                .update({
                    state: State.WAITING,
                    winner: null // Clear winner on reset
                })
                .eq("id", RAFFLE_ID)
                .select() // Optional: confirm update
                .single(); // Expect one row updated

            if (updateError) throw updateError;
            // State update will be reflected via the realtime subscription
            console.log("Admin: Raffle reset successfully via DB update.");

        } catch (err: any) {
            const errorMsg = `Failed to reset raffle: ${err?.message || 'Unknown error'}`;
            console.error("Admin Error resetting raffle:", errorMsg);
            setError(errorMsg);
        } finally {
            setIsLoading(false);
        }
    };


    // --- Render Admin UI ---
    return (
        <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
            <h1>Admin Raffle Dashboard</h1>

            {/* Display Error Messages */}
            {error && (
                <p style={{
                    color: 'red',
                    border: '1px solid red',
                    padding: '10px',
                    marginBottom: '1rem',
                    backgroundColor: '#ffeeee'
                }}>
                    <strong>Error:</strong> {error}
                </p>
            )}

            {/* Display Loading State */}
            {isLoading && <p style={{ fontStyle: 'italic', color: '#555' }}>Loading...</p>}

            {/* Raffle Status Section */}
            <div style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid #ccc', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
                <h2>Raffle Status (ID: {RAFFLE_ID})</h2>
                {raffleData ? (
                    <>
                        <p><strong>Current State:</strong> {currentState}</p>
                        <p><strong>Current Winner:</strong> {currentWinner || 'None'}</p>
                    </>
                ) : (
                    // Show only if not loading and no raffle data (implies initial fetch failed)
                    !isLoading && <p>Could not load raffle data.</p>
                )}
            </div>

            {/* Connected Users Section */}
            <div style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid #ccc', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
                <h2>Connected Users ({userList.length})</h2>
                {userList.length > 0 ? (
                    <ul style={{ maxHeight: '200px', overflowY: 'auto', listStyle: 'none', padding: '0 0 0 10px', margin: 0 }}>
                        {userList.map((userId) => (
                            <li key={userId} style={{ padding: '3px 0', borderBottom: '1px solid #eee', fontSize: '0.9em' }}>{userId}</li>
                        ))}
                    </ul>
                ) : (
                    <p style={{ color: '#666' }}>No users currently connected to the raffle room.</p>
                )}
            </div>

            {/* Action Buttons Section */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                <button
                    onClick={handleStartDraw}
                    disabled={isLoading || currentState !== State.WAITING || !!error}
                    style={{ padding: '10px 20px', fontSize: '1rem', cursor: (isLoading || currentState !== State.WAITING || !!error) ? 'not-allowed' : 'pointer', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px', opacity: (isLoading || currentState !== State.WAITING || !!error) ? 0.6 : 1 }}
                    title={currentState !== State.WAITING ? "Can only start when in WAITING state" : ""}
                >
                    {isLoading ? 'Starting...' : 'Start Draw'}
                </button>

                <button
                    onClick={handlePickWinner}
                    disabled={isLoading || currentState !== State.DRAWING || userList.length === 0 || !!error}
                    style={{ padding: '10px 20px', fontSize: '1rem', cursor: (isLoading || currentState !== State.DRAWING || userList.length === 0 || !!error) ? 'not-allowed' : 'pointer', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '5px', opacity: (isLoading || currentState !== State.DRAWING || userList.length === 0 || !!error) ? 0.6 : 1 }}
                    title={currentState !== State.DRAWING ? "Can only pick winner during DRAWING state" : userList.length === 0 ? "No users connected to pick from" : ""}
                >
                    {isLoading ? 'Picking...' : `Pick Winner (${userList.length} Eligible)`}
                </button>

                <button
                    onClick={handleResetRaffle}
                    disabled={isLoading} // Allow reset anytime unless an action is in progress
                    style={{ padding: '10px 20px', fontSize: '1rem', cursor: isLoading ? 'not-allowed' : 'pointer', backgroundColor: '#ffc107', color: 'black', border: 'none', borderRadius: '5px', opacity: isLoading ? 0.6 : 1 }}
                    title="Resets the raffle to WAITING state and clears the winner."
                >
                    {isLoading ? 'Resetting...' : 'Reset Raffle'}
                </button>
            </div>
        </div>
    );
}