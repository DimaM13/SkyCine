import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { RoomInviteNotification } from '../types';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  clockOffset: number; // Server Time - Local Time
  getSyncedServerTime: () => number;
  currentInvite: RoomInviteNotification | null;
  clearInvite: () => void;
  setActivity: (activity?: string, status?: string) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [clockOffset, setClockOffset] = useState<number>(0);
  const [currentInvite, setCurrentInvite] = useState<RoomInviteNotification | null>(null);
  const offsetRef = useRef<number>(0);

  useEffect(() => {
    const newSocket = io(window.location.origin, {
      transports: ['polling', 'websocket'],
      upgrade: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 10000,
    });

    setSocket(newSocket);

    newSocket.on('connect', () => {
      setIsConnected(true);

      // Identify user if logged in
      if (user) {
        newSocket.emit('user:connect', {
          userId: user.id,
          username: user.username,
          avatarUrl: user.avatarUrl,
        });
      }

      // Initial NTP Sync
      performNtpSync(newSocket);
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
    });

    newSocket.on('sync:pong', (data: { clientTimestamp: number; serverTimestamp: number }) => {
      const now = Date.now();
      const rtt = now - data.clientTimestamp;
      const estimatedServerTimeAtResponse = data.serverTimestamp + rtt / 2;
      const calculatedOffset = estimatedServerTimeAtResponse - now;

      offsetRef.current = calculatedOffset;
      setClockOffset(calculatedOffset);
    });

    // Room Invitations
    newSocket.on('notification:room_invite', (invite: RoomInviteNotification) => {
      setCurrentInvite(invite);
    });

    // Periodic NTP Ping every 10 seconds
    const interval = setInterval(() => {
      if (newSocket.connected) {
        performNtpSync(newSocket);
      }
    }, 10000);

    return () => {
      clearInterval(interval);
      newSocket.disconnect();
    };
  }, []);

  // Update socket identity when user changes
  useEffect(() => {
    if (socket && socket.connected && user) {
      socket.emit('user:connect', {
        userId: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
      });
    }
  }, [user, socket]);

  const performNtpSync = (s: Socket) => {
    s.emit('sync:ping', { clientTimestamp: Date.now() });
  };

  const getSyncedServerTime = React.useCallback(() => {
    return Date.now() + offsetRef.current;
  }, []);

  const clearInvite = React.useCallback(() => {
    setCurrentInvite(null);
  }, []);

  const setActivity = React.useCallback((activity?: string, status: string = 'online') => {
    if (socket && socket.connected) {
      socket.emit('user:activity', { activity, status });
    }
  }, [socket]);

  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        clockOffset,
        getSyncedServerTime,
        currentInvite,
        clearInvite,
        setActivity,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};
