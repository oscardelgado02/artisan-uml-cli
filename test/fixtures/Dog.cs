namespace Game.Creatures
{
    public class Dog : Animal, IPet
    {
        public string Name { get { return "dog"; } }
        public void Play(Animal owner) { }
        public override void Speak(string mood) { }
        private Mood _mood;
    }
}
