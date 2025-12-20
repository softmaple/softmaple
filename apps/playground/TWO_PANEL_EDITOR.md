# Two-Panel Text Editor

A simple, independent two-panel text editor built with React and TanStack Router.

## Features

- **Split Layout**: Side-by-side panels on desktop, stacked vertically on mobile
- **Independent Editors**: Each panel has its own state with no syncing
- **Responsive Design**: Adapts to screen size using Tailwind CSS
- **Character Count**: Real-time character count for both editors
- **Clean UI**: Minimal styling with backdrop blur and gradients

## How to Run

### Prerequisites
- Node.js 24+ installed
- pnpm installed (`npm install -g pnpm`)

### Steps

1. **Navigate to the playground app**:
   ```bash
   cd apps/playground
   ```

2. **Install dependencies** (if not already installed):
   ```bash
   pnpm install
   ```

3. **Start the development server**:
   ```bash
   pnpm dev
   ```

4. **Open your browser** and navigate to:
   ```
   http://localhost:3000/demo/two-panel-editor
   ```

   Or click on the "Two-Panel Editor Demo" card from the home page at `http://localhost:3000`

## Usage

- Type in either **Editor A** (left/top) or **Editor B** (right/bottom)
- Each editor maintains its own content independently
- Character count is displayed below each editor
- On mobile devices, the panels stack vertically for better usability

## Implementation Details

### File Location
```
apps/playground/src/routes/demo/two-panel-editor.tsx
```

### Key Technologies
- **React**: useState hooks for independent state management
- **TanStack Router**: File-based routing
- **Tailwind CSS**: Responsive grid layout and styling
- **TypeScript**: Type-safe component development

### Layout Breakdown
- Uses CSS Grid (`grid-cols-1 lg:grid-cols-2`) for responsive layout
- Each panel is a flex container with a header and textarea
- Textareas use `resize-none` and `min-h-[400px]` for consistent sizing
- Focus rings (blue for Editor A, green for Editor B) provide visual feedback

## Customization

You can easily customize:
- **Colors**: Modify the `focus:ring-*` classes in the textarea elements
- **Height**: Adjust `min-h-[400px]` values for different editor heights
- **Breakpoints**: Change `lg:` prefix to `md:` or `xl:` for different responsive behavior
- **Initial Content**: Add default values to the `useState` hooks

## Code Structure

```typescript
const TwoPanelEditor = () => {
  // Independent state for each editor
  const [editorAContent, setEditorAContent] = useState("");
  const [editorBContent, setEditorBContent] = useState("");

  return (
    // Responsive grid layout
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Editor A */}
      <textarea value={editorAContent} onChange={...} />
      
      {/* Editor B */}
      <textarea value={editorBContent} onChange={...} />
    </div>
  );
};
```

## Browser Support

Works in all modern browsers:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## License

Part of the softmaple monorepo. See the root LICENSE file for details.
