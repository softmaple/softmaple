/**
 * Utility functions for collaborative editor
 */

/**
 * Generate a random color for user avatars
 */
export function getRandomColor(): string {
  const colors = [
    '#FF6B6B', // Red
    '#4ECDC4', // Teal
    '#45B7D1', // Blue
    '#FFA07A', // Light Salmon
    '#98D8C8', // Mint
    '#FFD700', // Gold
    '#9370DB', // Medium Purple
    '#20B2AA', // Light Sea Green
    '#FF69B4', // Hot Pink
    '#87CEEB', // Sky Blue
  ];
  return colors[Math.floor(Math.random() * colors.length)] || '#45B7D1';
}

/**
 * Generate a unique room ID
 */
export function generateRoomId(): string {
  return `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Format timestamp to human-readable date
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

/**
 * Debounce function for text input
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}
