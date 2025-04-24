import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://wkafplnaexyyuobfufxa.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndrYWZwbG5hZXh5eXVvYmZ1ZnhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU0NjYwODEsImV4cCI6MjA2MTA0MjA4MX0.Sp9g2aWN24QoymYPoYJbxInnFNMautc26uJ1ba6Dvdc";


export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Define shared types/enums
export type PublicData = {
    id: number;
    created_at: string;
    state: State; // Use the enum directly
    winner?: string | null; // Allow null
}

export enum State {
    WAITING = "WAITING",
    DRAWING = "DRAWING",
    DRAWN = "DRAWN",
    ERROR = "ERROR", // Keep error state if needed
}

export const RAFFLE_ID = 1; // Define the target raffle ID
export const RAFFLE_ROOM_CHANNEL = `raffle-room-${RAFFLE_ID}`; // Channel name specific to the raffle

export interface PresencePayload {
    user: string; // The user ID you are tracking
    online_at: string;
}

export interface PresenceStateForUser extends PresencePayload {
    presence_ref: string;
}

/**
 * Generates a simple pseudo-unique ID for demo purposes.
 * In a real app, use authenticated user IDs (e.g., supabase.auth.user().id).
 */
export const generateUniqueUserId = (): string => {
    return `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};


/**
 * Picks a random element from an array.
 * @param arr The array to pick from.
 * @returns A random element from the array, or undefined if the array is empty.
 */
export const pickRandomElement = <T,>(arr: T[]): T | undefined => {
    if (!arr || arr.length === 0) {
        return undefined;
    }
    const randomIndex = Math.floor(Math.random() * arr.length);
    return arr[randomIndex];
};

/**
 * Generates a random HSL color string for flashing effect.
 * @returns A string like 'hsl(120, 80%, 60%)'
 */
export const getRandomColor = (): string => {
    const hue = Math.floor(Math.random() * 360);
    const saturation = Math.floor(Math.random() * 30) + 70; // 70-100%
    const lightness = Math.floor(Math.random() * 20) + 50; // 50-70%
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};