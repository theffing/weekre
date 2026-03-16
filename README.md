# Weekre
Weekly task tracker

Create tasks by clicking where you want them

## Application View



### Adding new Stats Cards

```
addStatCard('myCard', 'My Card Title', async () => {
  const data = await window.api.someNewStat();
  return buildBars(data, d => d.label, d => d.count, 'var(--bar-dow)');
});
```