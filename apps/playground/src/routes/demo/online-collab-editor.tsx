import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { Textarea } from "@softmaple/ui/components/textarea";
import {
  Copy,
  Share2,
  Users,
  Plus,
  LogIn,
  Clock,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useCollabEditor } from "@/modules/collab-editor/hooks/use-collab-editor";
import { useRecentRooms } from "@/modules/collab-editor/hooks/use-recent-rooms";
import { useTextChange } from "@/modules/collab-editor/hooks/use-text-change";

export const Route = createFileRoute("/demo/online-collab-editor")({
  component: OnlineCollabEditor,
});

function OnlineCollabEditor() {
  const [userName, setUserName] = useState('');
  const [roomName, setRoomName] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [hasJoined, setHasJoined] = useState(false);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const {
    roomManager,
    currentRoom,
    text,
    participants,
    isLoading,
    error,
    createRoom,
    joinRoom,
    leaveRoom,
  } = useCollabEditor();
  
  const { recentRooms, isLoadingRooms } = useRecentRooms();
  const { handleTextChange } = useTextChange(roomManager, () => {});
  
  // Check URL params for room ID
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    if (roomId) {
      setJoinRoomId(roomId);
    }
  }, []);
  
  const handleCreateRoom = useCallback(async () => {
    const roomId = await createRoom(roomName, userName);
    if (roomId) {
      setHasJoined(true);
      // Update URL with room ID
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}?room=${roomId}`
      );
    }
  }, [createRoom, roomName, userName]);
  
  const handleJoinRoom = useCallback(async () => {
    const success = await joinRoom(joinRoomId, userName);
    if (success) {
      setHasJoined(true);
      // Update URL with room ID
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}?room=${joinRoomId}`
      );
    }
  }, [joinRoom, joinRoomId, userName]);
  
  const handleLeaveRoom = useCallback(async () => {
    await leaveRoom();
    setHasJoined(false);
    // Clear URL params
    window.history.replaceState(null, '', window.location.pathname);
  }, [leaveRoom]);
  
  const handleTextAreaChange = useCallback(
    async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      
      // Save cursor position
      const cursorPos = e.target.selectionStart;
      
      handleTextChange(newText);
      
      // Restore cursor position
      setTimeout(() => {
        if (textareaRef.current) {
          const safePos = Math.min(cursorPos, newText.length);
          textareaRef.current.setSelectionRange(safePos, safePos);
        }
      }, 0);
    },
    [handleTextChange]
  );
  
  const copyRoomLink = useCallback(() => {
    if (!currentRoom) return;
    
    const roomLink = `${window.location.origin}/demo/online-collab-editor?room=${currentRoom.id}`;
    navigator.clipboard.writeText(roomLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [currentRoom]);
  
  if (!hasJoined) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-pink-900 p-4">
        <div className="w-full max-w-4xl">
          <div className="text-center mb-8">
            <h1 className="text-5xl font-bold text-white mb-4">
              Online Collaborative Editor
            </h1>
            <p className="text-xl text-white/80">
              Create or join a room to start collaborating in real-time
            </p>
          </div>

          {error && (
            <Card className="mb-6 bg-red-900/20 backdrop-blur-md border-red-500/50">
              <CardContent className="flex items-center gap-2 p-4">
                <AlertCircle className="w-5 h-5 text-red-400" />
                <p className="text-red-400">{error}</p>
              </CardContent>
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            <Card className="bg-white/10 backdrop-blur-md border-white/20">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  Create New Room
                </CardTitle>
                <CardDescription className="text-white/60">
                  Start a new collaborative document
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Your name"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="bg-white/5 border-white/20 text-white placeholder:text-white/40"
                />
                <Input
                  placeholder="Room name"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="bg-white/5 border-white/20 text-white placeholder:text-white/40"
                />
                <Button
                  onClick={handleCreateRoom}
                  disabled={!userName || !roomName || isLoading}
                  className="w-full"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Create Room'
                  )}
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-md border-white/20">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <LogIn className="w-5 h-5" />
                  Join Existing Room
                </CardTitle>
                <CardDescription className="text-white/60">
                  Enter a room ID to join
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Your name"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="bg-white/5 border-white/20 text-white placeholder:text-white/40"
                />
                <Input
                  placeholder="Room ID"
                  value={joinRoomId}
                  onChange={(e) => setJoinRoomId(e.target.value)}
                  className="bg-white/5 border-white/20 text-white placeholder:text-white/40"
                />
                <Button
                  onClick={handleJoinRoom}
                  disabled={!userName || !joinRoomId || isLoading}
                  className="w-full"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Join Room'
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {isLoadingRooms && (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}
          
          {recentRooms.length > 0 && (
            <Card className="mt-6 bg-white/10 backdrop-blur-md border-white/20">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Recent Rooms
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {recentRooms.map((room) => (
                    <button
                      key={room.id}
                      onClick={() => setJoinRoomId(room.id)}
                      className="w-full text-left p-3 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                    >
                      <div className="font-medium">{room.name}</div>
                      <div className="text-sm text-white/60">
                        ID: {room.id} • Created {new Date(room.createdAt).toLocaleDateString()}
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-pink-900 text-white">
      <div className="container mx-auto p-4 flex-1 flex flex-col">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold">{currentRoom?.name}</h1>
              <p className="text-white/80">
                Room ID: <span className="font-mono bg-white/10 px-2 py-1 rounded">{currentRoom?.id}</span>
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleLeaveRoom}
            >
              Leave Room
            </Button>
          </div>
          
          <div className="flex flex-wrap gap-2 mb-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={copyRoomLink}
              className="flex items-center gap-2"
            >
              {copied ? (
                <>✓ Copied!</>
              ) : (
                <>
                  <Share2 className="w-4 h-4" />
                  Share Room
                </>
              )}
            </Button>
            
            <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-md">
              <Users className="w-4 h-4" />
              <span className="text-sm">
                {participants.length + 1} participant{participants.length !== 0 ? 's' : ''}
              </span>
            </div>
            
            {participants.length > 0 && (
              <div className="flex items-center gap-2">
                {participants.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center gap-1 bg-white/10 px-2 py-1 rounded-md"
                    style={{ borderColor: user.color, borderWidth: 2 }}
                  >
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: user.color }}
                    />
                    <span className="text-sm">{user.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {currentRoom && (
            <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-lg p-3">
              <p className="text-sm text-white/80 mb-1">Share this link to collaborate:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-black/20 px-2 py-1 rounded text-xs break-all">
                  {window.location.origin}/demo/online-collab-editor?room={currentRoom.id}
                </code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={copyRoomLink}
                  className="shrink-0"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <Card className="flex-1 flex flex-col bg-white/10 backdrop-blur-md border-white/20">
          <CardHeader className="bg-white/5 border-b border-white/20">
            <CardTitle className="text-white">Document</CardTitle>
            <CardDescription className="text-white/60">
              Changes are synced in real-time and saved locally
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 p-0">
            <Textarea
              ref={textareaRef}
              value={text}
              onChange={handleTextAreaChange}
              placeholder="Start typing..."
              className="h-full w-full min-h-[400px] resize-none bg-transparent text-white placeholder:text-white/40 border-0 rounded-none p-4 focus-visible:ring-0"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default OnlineCollabEditor;
