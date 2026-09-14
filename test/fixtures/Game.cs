using System;
using System.Collections.Generic;

namespace Game.Creatures
{
    /// <summary>Animal doc comment (should be ignored).</summary>
    public abstract class Animal : UnityEngine.MonoBehaviour
    {
        protected string _name; // field
        public int Age { get; set; }
        private readonly List<Animal> _friends = new List<Animal>();
        public string Name
        {
            get { return _name; }
            private set { _name = value; }
        }

        public abstract void Speak(string mood = "happy");
        public virtual int GetSpeed() => 5;
        protected static Animal Create() { var local = 42; return null; }
        public class Nested { public int X; }
    }

    public interface IPet
    {
        string Name { get; }
        void Play(Animal owner);
    }

    public enum Mood
    {
        Happy = 1,
        Sleepy,
        Zoomies
    }
}
