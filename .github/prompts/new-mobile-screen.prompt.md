---
description: "Create a new React Native screen for the mobile app with NativeWind styling, React Navigation integration, and API data fetching"
agent: "mobile-dev"
argument-hint: "Describe the screen, e.g. 'Film stock detail screen showing properties, sample photos, and usage statistics'"
---
Create a new React Native screen for the FilmGallery mobile app.

Follow these patterns:
- Functional component with `export default`
- Use axios with `useApiContext()` for API calls
- Style with NativeWind `className` + React Native Paper components
- Icons from `lucide-react-native`
- Register screen in `mobile/App.js` Stack.Navigator
- Add navigation from parent screen

Theme colors:
- primary: #5A4632 (warm brown)
- secondary: #3E6B64 (teal)

Reference existing screens in `mobile/src/screens/` for patterns.
