---
description: "Create a new React component for the desktop client with HeroUI, Tailwind CSS, React Query data fetching, and proper hook patterns"
argument-hint: "Describe the component, e.g. 'A photo grid with infinite scroll, tag filtering, and bulk selection'"
---
Create a new React component for the FilmGallery desktop client.

Follow these patterns:
- Functional component with `export default`
- Use `useQuery` / `useMutation` from React Query for server data
- Import API functions from `../api`
- Wrap event handlers with `useCallback`, computed values with `useMemo`
- Style with Tailwind CSS utility classes + HeroUI components
- Icons from `lucide-react`
- File name: PascalCase.jsx

Reference existing components in `client/src/components/` for patterns.
Cache strategy must match the data type — see `CACHE_STRATEGIES` in `client/src/lib/queryClient.js`.
