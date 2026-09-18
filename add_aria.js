const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'client/src/CallScreen.jsx');
let content = fs.readFileSync(file, 'utf8');

// Replace titles with aria-label
content = content.replace(/<button([\s\S]+?)title=(["'{][^>]+?["'}])([\s\S]*?)>/g, (match, before, titleContent, after) => {
  // Check if it already has aria-label
  if (match.includes('aria-label=')) return match;
  
  let newMatch = `<button${before}title=${titleContent} aria-label=${titleContent}${after}>`;
  
  // Add aria-pressed or aria-expanded if there's an 'active' or state check
  if (newMatch.includes('{!micOn ? \'danger\' : \'\'}')) newMatch = newMatch.replace('>', ' aria-pressed={micOn}>');
  else if (newMatch.includes('{!camOn ? \'danger\' : \'\'}')) newMatch = newMatch.replace('>', ' aria-pressed={camOn}>');
  else if (newMatch.includes('showHandRaise')) newMatch = newMatch.replace('>', ' aria-expanded={showHandRaise}>');
  else if (newMatch.includes('showPolls')) newMatch = newMatch.replace('>', ' aria-expanded={showPolls}>');
  else if (newMatch.includes('showWhiteboard')) newMatch = newMatch.replace('>', ' aria-expanded={showWhiteboard}>');
  else if (newMatch.includes('captionsEnabled')) newMatch = newMatch.replace('>', ' aria-pressed={captionsEnabled}>');
  else if (newMatch.includes('isSharingScreen')) newMatch = newMatch.replace('>', ' aria-pressed={isSharingScreen}>');
  else if (newMatch.includes('showEffects')) newMatch = newMatch.replace('>', ' aria-expanded={showEffects}>');
  else if (newMatch.includes('showChat')) newMatch = newMatch.replace('>', ' aria-expanded={showChat}>');
  else if (newMatch.includes('isPinned ? \'Unpin')) newMatch = newMatch.replace('>', ' aria-pressed={isPinned}>');
  
  return newMatch;
});

fs.writeFileSync(file, content, 'utf8');
console.log('Added aria attributes');
